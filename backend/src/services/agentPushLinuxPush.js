/**
 * Agent Push — Linux push, ported from agent_push_webapp's push/linux_push.py.
 * paramiko's SSH/SFTP sequence maps almost directly onto the SSH utilities
 * this codebase already uses for Software Status / Test Deploy's Linux
 * installs — no OS-specific blocker here, unlike Windows push.
 *
 *   1. Check whether the agent is already installed (sshVerify's own
 *      LINUX_CONFIG already checks dcservice.service + its binary path).
 *   2. Upload the .bin + serverinfo.json and run the installer in one
 *      sshUploadAndRun call (handles SFTP + chmod + execute + timeout).
 *   3. Parse the vendor's own success marker text from the output.
 *   4. Clean up the staged files.
 *
 * Known limitation carried forward from this codebase's existing SSH
 * installs (not a regression introduced here): sshRunCommand/sshUploadAndRun
 * don't inject a password on an interactive sudo prompt the way the
 * original tool's pty-based handler did — this assumes root login or
 * passwordless sudo, the same assumption Software Status/Test Deploy's own
 * Linux installs already make.
 */
const path = require('path');
const { sshVerify, sshUploadAndRun, sshRunCommand } = require('../utils/sshVerify');

const SUCCESS_MARKERS = [
  'UEMS Agent has been Installed Successfully',
  'UEMS Agent Installation Successfully',
  'Agent Installation Successfully',
];

const INSTALL_TIMEOUT_SECONDS = 900; // matches the vendor tool's 15-minute default

class Logger {
  constructor(callback) {
    this.lines = [];
    this.callback = callback;
  }
  log(msg) {
    this.lines.push(msg);
    if (this.callback) {
      try { this.callback(msg); } catch { /* a logging hiccup must never abort the push */ }
    }
  }
  text() {
    return this.lines.join('\n');
  }
}

/**
 * @param {{ ip, username, password, port?, pkg, forceReinstall?, logCallback? }} opts
 *   pkg: { binPath, serverinfoPath }
 * @returns Promise<{ success, log, alreadyInstalled }>
 */
async function pushLinuxAgent({ ip, username, password, port = 22, pkg, forceReinstall = false, logCallback }) {
  const log = new Logger(logCallback);
  const overallStart = Date.now();
  const remoteDir = '/tmp';

  try {
    if (!forceReinstall) {
      log.log(`[${ip}] Checking for an existing agent install over SSH...`);
      const check = await sshVerify({ host: ip, port, username, password, osType: 'linux' });
      if (!check.connected) {
        log.log(`[${ip}] Could not connect over SSH: ${check.error || check.restricted_reason}`);
        return { success: false, log: log.text(), alreadyInstalled: false };
      }
      if (check.installed) {
        log.log(`[${ip}] Endpoint Central agent already installed (service: ${check.service?.status}, `
          + `file exists: ${check.file?.exists}) — skipped.`);
        return { success: true, log: log.text(), alreadyInstalled: true };
      }
    } else {
      log.log(`[${ip}] force_reinstall set — skipping the already-installed check.`);
    }

    const sudoPrefix = username !== 'root' ? 'sudo ' : '';
    const command = `chmod +x {installer} && ${sudoPrefix}timeout ${INSTALL_TIMEOUT_SECONDS} {installer}`;

    log.log(`[${ip}] Uploading ${path.basename(pkg.binPath)} and serverinfo.json to ${remoteDir} ...`);
    const r = await sshUploadAndRun({
      host: ip, port, username, password, remoteDir,
      files: [
        { localPath: pkg.binPath, placeholder: 'installer' },
        { localPath: pkg.serverinfoPath, placeholder: 'serverinfo' },
      ],
      command, timeout: (INSTALL_TIMEOUT_SECONDS + 30) * 1000,
    });
    log.log((r.output || '').trim());

    if (!r.connected) {
      log.log(`[${ip}] SSH push failed: ${r.error}`);
      return { success: false, log: log.text(), alreadyInstalled: false };
    }

    const success = SUCCESS_MARKERS.some((m) => (r.output || '').includes(m));

    const binRemote = `${remoteDir}/${path.basename(pkg.binPath)}`;
    const jsonRemote = `${remoteDir}/${path.basename(pkg.serverinfoPath)}`;
    await sshRunCommand({
      host: ip, port, username, password,
      command: `${sudoPrefix}rm -f ${binRemote} ${jsonRemote}`, timeout: 15000,
    });

    log.log(`[${ip}] Total push time: ${((Date.now() - overallStart) / 1000).toFixed(1)}s`);
    return { success, log: log.text(), alreadyInstalled: false };
  } catch (e) {
    log.log(`[${ip}] Error: ${e.message}`);
    return { success: false, log: log.text(), alreadyInstalled: false };
  }
}

module.exports = { pushLinuxAgent };
