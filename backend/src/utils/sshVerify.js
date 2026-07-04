const { Client } = require('ssh2');
const path = require('path');
const fs   = require('fs');

// ── OS-specific constants ─────────────────────────────────────────────────────
const LINUX_CONFIG = {
  platform:    'linux',
  serviceName: 'dcservice.service',
  binaryPath:  '/usr/local/manageengine/uems_agent/bin/dcservice',
};

const WINDOWS_CONFIG = {
  platform:    'windows',
  serviceName: 'ManageEngine UEMS - Agent',
  binaryPath:  'C:\\Program Files (x86)\\ManageEngine\\UEMS_Agent\\bin\\dcagentservice.exe',
};

const NESSUS_LINUX_CONFIG = {
  platform:    'linux',
  serviceName: 'nessusagent',
  binaryPath:  '/opt/nessus_agent/sbin/nessus-agent',
};

const NESSUS_WINDOWS_CONFIG = {
  platform:    'windows',
  serviceName: 'Tenable Nessus Agent',
  binaryPath:  'C:\\Program Files\\Tenable\\Nessus Agent\\nessus-service.exe',
};

const SEP = '---SEP---';

function isWindows(osType) {
  return /windows/i.test(osType || '');
}

function getConfig(osType) {
  return isWindows(osType) ? WINDOWS_CONFIG : LINUX_CONFIG;
}

function getNessusConfig(osType) {
  return isWindows(osType) ? NESSUS_WINDOWS_CONFIG : NESSUS_LINUX_CONFIG;
}

// ── Command builders ─────────────────────────────────────────────────────────
function buildLinuxCmdFor({ serviceName, binaryPath } = LINUX_CONFIG) {
  return [
    `systemctl status ${serviceName} 2>&1 | head -40`,
    `echo "${SEP}"`,
    `test -f ${binaryPath} && echo "FILE_EXISTS" || echo "FILE_NOT_FOUND"`,
  ].join(' ; ');
}

function buildWindowsCmdFor({ serviceName, binaryPath } = WINDOWS_CONFIG) {
  const script = [
    `$svc = Get-Service '${serviceName}' -ErrorAction SilentlyContinue`,
    `if ($svc) { $svc.Status.ToString() } else { 'NOT_FOUND' }`,
    `'${SEP}'`,
    `if (Test-Path '${binaryPath}') { 'FILE_EXISTS' } else { 'FILE_NOT_FOUND' }`,
  ].join('; ');
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  return `powershell -NoProfile -EncodedCommand ${encoded}`;
}

// Keep old names as aliases for backward compat
const buildLinuxCmd   = () => buildLinuxCmdFor(LINUX_CONFIG);
const buildWindowsCmd = () => buildWindowsCmdFor(WINDOWS_CONFIG);

// ── Output parsers ────────────────────────────────────────────────────────────
function parseLinuxService(raw) {
  if (/active \(running\)/i.test(raw))                                  return 'running';
  if (/active \(exited\)/i.test(raw))                                   return 'exited';
  if (/inactive \(dead\)/i.test(raw))                                   return 'inactive';
  if (/activating/i.test(raw))                                          return 'activating';
  if (/failed/i.test(raw))                                              return 'failed';
  if (/could not be found|no such unit|not.found/i.test(raw))           return 'not_found';
  return 'unknown';
}

function parseWindowsService(raw) {
  const t = raw.trim();
  if (/^Running$/im.test(t))                                            return 'running';
  if (/^Stopped$/im.test(t))                                            return 'stopped';
  if (/^Paused$/im.test(t))                                             return 'paused';
  if (/^StartPending$/im.test(t))                                       return 'activating';
  if (/^StopPending$/im.test(t))                                        return 'stopping';
  if (/^NOT_FOUND$/im.test(t))                                          return 'not_found';
  return 'unknown';
}

// ── Main verify function ──────────────────────────────────────────────────────
/**
 * @param {{ host, port?, username, password, osType?, timeout?, cfgOverride? }} opts
 * cfgOverride: { linuxConfig, windowsConfig } — pass Nessus/custom service configs
 */
function sshVerify({ host, port = 22, username, password, osType = '', timeout = 14000, cfgOverride }) {
  const baseCfg = cfgOverride
    ? (isWindows(osType) ? cfgOverride.windowsConfig : cfgOverride.linuxConfig)
    : getConfig(osType);
  const cfg  = baseCfg;
  const cmd  = cfg.platform === 'windows' ? buildWindowsCmdFor(cfg) : buildLinuxCmdFor(cfg);
  const parseService = cfg.platform === 'windows' ? parseWindowsService : parseLinuxService;

  return new Promise((resolve) => {
    const conn = new Client();
    let settled = false;

    const done = (result) => {
      if (settled) return;
      settled = true;
      try { conn.end(); } catch {}
      resolve({ ...result, platform: cfg.platform });
    };

    const timer = setTimeout(() => {
      try { conn.destroy(); } catch {}
      done({ connected: false, error: `Connection timed out after ${timeout / 1000}s`, service: null, file: null });
    }, timeout + 2000);

    conn.on('ready', () => {
      conn.exec(cmd, (err, stream) => {
        if (err) {
          clearTimeout(timer);
          return done({ connected: true, error: `exec failed: ${err.message}`, service: null, file: null });
        }

        let raw = '';
        stream.on('data', chunk => { raw += chunk; });
        stream.stderr.on('data', chunk => { raw += chunk; });

        stream.on('close', () => {
          clearTimeout(timer);

          const sepIdx   = raw.indexOf(SEP);
          const svcRaw   = (sepIdx >= 0 ? raw.slice(0, sepIdx) : raw).trim();
          const fileRaw  = (sepIdx >= 0 ? raw.slice(sepIdx + SEP.length) : '').trim();

          const serviceStatus = parseService(svcRaw);
          const fileExists    = fileRaw.includes('FILE_EXISTS');

          done({
            connected: true,
            error: null,
            service: { status: serviceStatus, output: svcRaw, name: cfg.serviceName },
            file:    { exists: fileExists, path: cfg.binaryPath },
            installed: serviceStatus === 'running' || fileExists,
          });
        });
      });
    });

    conn.on('error', (err) => {
      clearTimeout(timer);
      done({ connected: false, error: err.message, service: null, file: null });
    });

    try {
      conn.connect({ host, port: Number(port), username, password, readyTimeout: timeout });
    } catch (e) {
      clearTimeout(timer);
      done({ connected: false, error: e.message, service: null, file: null });
    }
  });
}

/**
 * SSH into a host and run an arbitrary command (used for remote installation).
 * @param {{ host, port?, username, password, command, timeout? }} opts
 * @returns Promise<{ connected, error, output, exitCode }>
 */
function sshRunCommand({ host, port = 22, username, password, command, timeout = 300000 }) {
  return new Promise((resolve) => {
    const conn = new Client();
    let settled = false;

    const done = (result) => {
      if (settled) return;
      settled = true;
      try { conn.end(); } catch {}
      resolve(result);
    };

    const timer = setTimeout(() => {
      try { conn.destroy(); } catch {}
      done({ connected: false, error: `Install timed out after ${Math.round(timeout / 60000)} min`, output: '', exitCode: null });
    }, timeout + 5000);

    conn.on('ready', () => {
      conn.exec(command, (err, stream) => {
        if (err) {
          clearTimeout(timer);
          return done({ connected: true, error: `exec failed: ${err.message}`, output: '', exitCode: null });
        }
        let output = '';
        stream.on('data', chunk => { output += chunk; });
        stream.stderr.on('data', chunk => { output += chunk; });
        stream.on('close', (code) => {
          clearTimeout(timer);
          done({ connected: true, error: null, output, exitCode: code });
        });
      });
    });

    conn.on('error', (err) => {
      clearTimeout(timer);
      done({ connected: false, error: err.message, output: '', exitCode: null });
    });

    try {
      conn.connect({ host, port: Number(port), username, password, readyTimeout: 15000 });
    } catch (e) {
      clearTimeout(timer);
      done({ connected: false, error: e.message, output: '', exitCode: null });
    }
  });
}

/**
 * Upload one or more local files to the remote VM via SFTP, then run a command.
 *
 * @param {{
 *   host, port?, username, password, remoteDir, command, timeout?,
 *   files: Array<{ localPath: string, placeholder: string }>
 * }} opts
 *
 * Each file's remote path replaces `{placeholder}` in the command string.
 * Files are uploaded sequentially; the first failure aborts the rest.
 *
 * @returns Promise<{ connected, error, output, exitCode }>
 */
function sshUploadAndRun({ host, port = 22, username, password, files, remoteDir, command, timeout = 300000 }) {
  return new Promise((resolve) => {
    const conn = new Client();
    let settled = false;
    let output  = '';

    const done = (result) => {
      if (settled) return;
      settled = true;
      try { conn.end(); } catch {}
      resolve(result);
    };

    const timer = setTimeout(() => {
      try { conn.destroy(); } catch {}
      done({ connected: false, error: `Timed out after ${Math.round(timeout / 60000)} min`, output, exitCode: null });
    }, timeout + 5000);

    conn.on('ready', () => {
      conn.sftp((err, sftp) => {
        if (err) {
          clearTimeout(timer);
          return done({ connected: true, error: `SFTP init failed: ${err.message}`, output, exitCode: null });
        }

        const baseDir = remoteDir.replace(/[/\\]+$/, '');

        // Upload files sequentially, collecting remote paths keyed by placeholder
        const remotePaths = {};

        const uploadNext = (idx) => {
          if (idx >= files.length) {
            // All uploads done — substitute placeholders and exec
            sftp.end();
            let cmd = command;
            for (const [ph, rp] of Object.entries(remotePaths)) {
              cmd = cmd.replace(new RegExp(`\\{${ph}\\}`, 'g'), rp);
            }
            output += `\n[EXEC] ${cmd}\n\n`;

            conn.exec(cmd, (execErr, stream) => {
              if (execErr) {
                clearTimeout(timer);
                return done({ connected: true, error: `exec failed: ${execErr.message}`, output, exitCode: null });
              }
              stream.on('data', chunk => { output += chunk; });
              stream.stderr.on('data', chunk => { output += chunk; });
              stream.on('close', (code) => {
                clearTimeout(timer);
                done({ connected: true, error: null, output, exitCode: code });
              });
            });
            return;
          }

          const { localPath, placeholder } = files[idx];
          const filename   = path.basename(localPath);
          const remotePath = `${baseDir}/${filename}`;
          output += `[SFTP] Uploading ${localPath} → ${remotePath}\n`;

          sftp.fastPut(localPath, remotePath, {}, (uploadErr) => {
            if (uploadErr) {
              sftp.end();
              clearTimeout(timer);
              return done({ connected: true, error: `Upload failed (${filename}): ${uploadErr.message}`, output, exitCode: null });
            }
            output += `[SFTP] ${filename} uploaded ✓\n`;
            remotePaths[placeholder] = remotePath;
            uploadNext(idx + 1);
          });
        };

        uploadNext(0);
      });
    });

    conn.on('error', (err) => {
      clearTimeout(timer);
      done({ connected: false, error: err.message, output, exitCode: null });
    });

    try {
      conn.connect({ host, port: Number(port), username, password, readyTimeout: 15000 });
    } catch (e) {
      clearTimeout(timer);
      done({ connected: false, error: e.message, output, exitCode: null });
    }
  });
}

module.exports = {
  sshVerify, sshRunCommand, sshUploadAndRun,
  getConfig, getNessusConfig, isWindows,
  LINUX_CONFIG, WINDOWS_CONFIG, NESSUS_LINUX_CONFIG, NESSUS_WINDOWS_CONFIG,
};
