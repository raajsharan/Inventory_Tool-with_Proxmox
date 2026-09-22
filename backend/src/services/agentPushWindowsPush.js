/**
 * Agent Push — Windows push, ported from agent_push_webapp's
 * push/windows_push.py, but rebuilt on WinRM instead of RemCom.exe.
 *
 * RemCom.exe is a Windows PE binary — this backend runs on Linux, and
 * execFile()-ing a .exe there fails the same way PsExec did for Nessus
 * (see winInstall.js's psexecInstall platform guard). WinRM already works
 * from this Linux backend for Windows targets (Software Status, Test
 * Deploy), so this reuses those exact primitives instead of reimplementing
 * a Windows-only remote-exec mechanism:
 *   - winrmVerify()  — already-installed check (Test-Path + Get-Service)
 *   - winrmInstall() — file copy (Copy-Item -ToSession) + remote command
 *
 * Two package formats, auto-detected by agentPushService.detectWindowsPackage():
 *   A) Raw MSI: UEMSAgent.msi + UEMSAgent.mst (+ up to 2 root certs)
 *   B) InstallShield bootstrapper: a single *_Agent.exe, silently installed
 *      via its recorded response.iss (see agent_push_webapp/README.md's
 *      one-time recording instructions — the same response.iss file works
 *      for every location using this format).
 *
 * msiexec/InstallShield's own exit code isn't reliably synchronous even
 * over WinRM (msiexec routinely hands off to the Windows Installer service
 * and returns before the real work is done) — so, matching the original
 * tool's own caution, this polls winrmVerify() afterward for real
 * completion rather than trusting the launch call alone.
 */
const path = require('path');
const { winrmInstall } = require('../utils/winInstall');
const { winrmVerify } = require('../utils/sshVerify');

const POLL_INTERVAL_MS = 15000;
const VERIFY_TIMEOUT_MS = 20 * 60 * 1000; // 20 min — matches config.MSIEXEC_TIMEOUT_SECONDS upstream

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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

async function pollForInstallCompletion({ ip, username, password, port, log }) {
  const deadline = Date.now() + VERIFY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const r = await winrmVerify({ host: ip, username, password, port });
    if (r.connected && r.installed) {
      log.log(`[${ip}] Install confirmed via WinRM (service: ${r.service?.status}, file exists: ${r.file?.exists}).`);
      return true;
    }
    await sleep(POLL_INTERVAL_MS);
  }
  log.log(`[${ip}] Gave up waiting for install confirmation after ${Math.round(VERIFY_TIMEOUT_MS / 1000)}s.`);
  return false;
}

async function pushViaMsi({ ip, domain, username, password, port, pkg, log }) {
  const fullUser = domain ? `${domain}\\${username}` : username;
  const remoteDir = `C:/Windows/Temp/AgentPush_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
  const remoteDirWin = remoteDir.replace(/\//g, '\\');

  const files = [pkg.msiPath, pkg.mstPath, ...pkg.certPaths];
  log.log(`[${ip}] Copying ${files.length} file(s) to ${remoteDirWin} ...`);

  const mstRemote = `${remoteDirWin}\\${path.basename(pkg.mstPath)}`;
  const msiRemote = `${remoteDirWin}\\${path.basename(pkg.msiPath)}`;
  const command = `msiexec /i "${msiRemote}" TRANSFORMS="${mstRemote}" /qn REBOOT="ReallySuppress" ENABLESILENT=yes INSTALLSOURCE=SOM`;

  const r = await winrmInstall({
    host: ip, username: fullUser, password, port,
    files, remoteDir, command, timeout: 300000,
  });
  const redacted = (r.output || '').split(password).join('********');
  log.log(redacted.trim());
  if (!r.connected) {
    log.log(`[${ip}] WinRM connection/copy failed: ${r.error}`);
    return false;
  }

  log.log(`[${ip}] msiexec launched — polling for real completion (WinRM install can hand off to the Windows Installer service before finishing)...`);
  return pollForInstallCompletion({ ip, username: fullUser, password, port, log });
}

async function pushViaInstallShieldExe({ ip, domain, username, password, port, pkg, responseIssPath, log }) {
  if (!responseIssPath) {
    log.log(`[${ip}] No InstallShield response.iss configured — record one once per environment `
      + `('${pkg.exeName} /r /f1"C:\\response.iss"' on a test machine) and set it in Agent Push Locations.`);
    return false;
  }

  const fullUser = domain ? `${domain}\\${username}` : username;
  const remoteDir = `C:/Windows/Temp/AgentPush_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
  const remoteDirWin = remoteDir.replace(/\//g, '\\');

  const exeRemote = `${remoteDirWin}\\${pkg.exeName}`;
  const responseRemote = `${remoteDirWin}\\${path.basename(responseIssPath)}`;
  const command = `& "${exeRemote}" /s /f1"${responseRemote}" /f2"${remoteDirWin}\\install.log" /sms`;

  log.log(`[${ip}] Copying ${pkg.exeName} and response.iss to ${remoteDirWin} ...`);
  const r = await winrmInstall({
    host: ip, username: fullUser, password, port,
    files: [pkg.exePath, responseIssPath], remoteDir, command, timeout: 300000,
  });
  const redacted = (r.output || '').split(password).join('********');
  log.log(redacted.trim());
  if (!r.connected) {
    log.log(`[${ip}] WinRM connection/copy failed: ${r.error}`);
    return false;
  }

  log.log(`[${ip}] InstallShield silent install launched — polling for real completion...`);
  return pollForInstallCompletion({ ip, username: fullUser, password, port, log });
}

/**
 * @param {{ ip, domain, username, password, port?, pkg, responseIssPath?, forceReinstall?, logCallback? }} opts
 *   pkg: { kind: 'msi', msiPath, mstPath, certPaths } | { kind: 'exe', exePath, exeName }
 *   forceReinstall: skip the already-installed check and push regardless — the
 *     original tool's own "force reinstall" option only ever applied to the
 *     vendor-tool-wrapper path we're not porting (its own code says so), so
 *     this gives the option real, working behavior on the one push path
 *     that survives here.
 * @returns Promise<{ success, log, alreadyInstalled }>
 */
async function pushWindowsAgent({ ip, domain, username, password, port = 5985, pkg, responseIssPath, forceReinstall = false, logCallback }) {
  const log = new Logger(logCallback);
  const overallStart = Date.now();

  try {
    if (!forceReinstall) {
      log.log(`[${ip}] Checking for an existing agent install via WinRM...`);
      const check = await winrmVerify({ host: ip, username, password, port });
      if (!check.connected) {
        log.log(`[${ip}] Could not reach WinRM: ${check.error}`);
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

    let success;
    if (pkg.kind === 'msi') {
      success = await pushViaMsi({ ip, domain, username, password, port, pkg, log });
    } else if (pkg.kind === 'exe') {
      success = await pushViaInstallShieldExe({ ip, domain, username, password, port, pkg, responseIssPath, log });
    } else {
      log.log(`[${ip}] No supported Windows package found (expected UEMSAgent.msi+.mst, or a single .exe).`);
      success = false;
    }

    log.log(`[${ip}] Total push time: ${((Date.now() - overallStart) / 1000).toFixed(1)}s`);
    return { success, log: log.text(), alreadyInstalled: false };
  } catch (e) {
    log.log(`[${ip}] Error: ${e.message}`);
    return { success: false, log: log.text(), alreadyInstalled: false };
  }
}

module.exports = { pushWindowsAgent };
