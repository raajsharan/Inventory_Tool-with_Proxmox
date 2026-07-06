const fs          = require('fs');
const path        = require('path');
const db          = require('../config/db');
const { decrypt } = require('../utils/crypto');
const {
  sshVerify, sshRunCommand, sshUploadAndRun, isWindows,
  NESSUS_LINUX_CONFIG, NESSUS_WINDOWS_CONFIG,
} = require('../utils/sshVerify');
const { winrmInstall, psexecInstall, wmiInstall } = require('../utils/winInstall');
const ApiError = require('../utils/ApiError');

const NESSUS_CFG_OVERRIDE = {
  linuxConfig:   NESSUS_LINUX_CONFIG,
  windowsConfig: NESSUS_WINDOWS_CONFIG,
};

const SOURCE_TABLE = {
  'MSL Assets':       'assets',
  'Beijing Assets':   'beijing_assets',
  'Ext. Assets':      'ext_assets',
  'Physical Servers': 'physical_esxi_servers',
};

function appendLog(logFilePath, ip, level, message) {
  if (!logFilePath) return;
  try {
    const tag  = level === 'SUCCESS' ? '[SUCCESS]' : `[${level || 'INFO'}]`;
    fs.appendFileSync(logFilePath, `${tag} ${ip}: ${message}\n`, 'utf8');
  } catch {}
}

// ── shared: resolve credentials ───────────────────────────────────────────────
async function resolveVm(ip_address, source, override_username, override_password) {
  const table = SOURCE_TABLE[source];
  if (!table) throw new ApiError(400, 'Unknown source: ' + source);

  const { rows } = await db.query(
    `SELECT asset_username, asset_password_encrypted, os_type
       FROM ${table}
      WHERE ip_address::text = $1 AND deleted_at IS NULL
      LIMIT 1`,
    [ip_address],
  );
  if (!rows.length) throw new ApiError(404, 'VM not found in ' + source);

  const row    = rows[0];
  const osType = row.os_type || '';
  let username = override_username || row.asset_username || null;
  let password = override_password || null;
  if (!password && row.asset_password_encrypted) {
    try { password = decrypt(row.asset_password_encrypted); } catch {}
  }
  return { username, password, osType };
}

const fileCheck = (p) => { if (!p) return null; try { return fs.existsSync(p); } catch { return false; } };

// ── GET /nessus-status ────────────────────────────────────────────────────────
async function get(req, res, next) {
  try {
    const sql = `
      WITH all_vms AS (
        SELECT COALESCE(NULLIF(TRIM(location), ''), 'Unknown') AS location,
               vm_name, os_hostname, ip_address::text AS ip_address,
               server_status,
               COALESCE(tenable_installed, false) AS nessus_installed,
               COALESCE(os_type, '') AS os_type,
               'MSL Assets' AS source,
               asset_username
          FROM assets
         WHERE deleted_at IS NULL
        UNION ALL
        SELECT COALESCE(NULLIF(TRIM(location), ''), 'Unknown'),
               vm_name, os_hostname, ip_address::text, server_status,
               COALESCE(tenable_installed, false), COALESCE(os_type, ''), 'Beijing Assets',
               asset_username
          FROM beijing_assets
         WHERE deleted_at IS NULL
        UNION ALL
        SELECT COALESCE(NULLIF(TRIM(location), ''), 'Unknown'),
               vm_name, os_hostname, ip_address::text, server_status,
               COALESCE(tenable_installed, false), COALESCE(os_type, ''), 'Ext. Assets',
               asset_username
          FROM ext_assets
         WHERE deleted_at IS NULL
        UNION ALL
        SELECT COALESCE(NULLIF(TRIM(location), ''), 'Unknown'),
               vm_name, os_hostname, ip_address::text, server_status,
               COALESCE(tenable_installed, false), COALESCE(os_type, ''), 'Physical Servers',
               asset_username
          FROM physical_esxi_servers
         WHERE deleted_at IS NULL
      )
      SELECT location,
        COUNT(*)::int                                                              AS total,
        SUM(CASE WHEN nessus_installed     THEN 1 ELSE 0 END)::int               AS installed,
        SUM(CASE WHEN NOT nessus_installed THEN 1 ELSE 0 END)::int               AS not_installed,
        ROUND(SUM(CASE WHEN nessus_installed THEN 1 ELSE 0 END)*100.0/NULLIF(COUNT(*),0),1) AS compliance_pct,
        JSON_AGG(JSON_BUILD_OBJECT(
          'vm_name',vm_name,'os_hostname',os_hostname,'ip_address',ip_address,
          'server_status',server_status,'nessus_installed',nessus_installed,
          'os_type',os_type,'source',source,'asset_username',asset_username
        ) ORDER BY nessus_installed, vm_name) AS vms
      FROM all_vms
      -- Hypervisors / appliances cannot take an agent install — not eligible.
      WHERE os_type NOT ILIKE '%esxi%'
        AND os_type NOT ILIKE '%vmware%'
        AND os_type NOT ILIKE '%appliance%'
        AND os_type NOT ILIKE '%proxmox%'
        AND REPLACE(REPLACE(os_type, '-', ''), ' ', '') NOT ILIKE '%eveng%'
      GROUP BY location ORDER BY location
    `;
    const { rows } = await db.query(sql);
    const overall  = rows.reduce(
      (a, r) => { a.total += r.total; a.installed += r.installed; a.not_installed += r.not_installed; return a; },
      { total: 0, installed: 0, not_installed: 0 },
    );
    overall.compliance_pct = overall.total
      ? Math.round((overall.installed / overall.total) * 1000) / 10 : 0;
    res.json({ locations: rows, overall });
  } catch (e) { next(e); }
}

// ── POST /nessus-status/verify ────────────────────────────────────────────────
async function verify(req, res, next) {
  try {
    const { ip_address, source, port = 22 } = req.body;
    if (!ip_address || !source) throw new ApiError(400, 'ip_address and source are required');

    // Credentials always come from the asset record — no manual overrides.
    const { username, password, osType } = await resolveVm(ip_address, source);

    if (!username) return res.json({ needs_credentials: true, has_username: false, has_password: false, os_type: osType });
    if (!password) return res.json({ needs_credentials: true, has_username: true, prefill_username: username, has_password: false, os_type: osType });

    const result = await sshVerify({ host: ip_address, port, username, password, osType, cfgOverride: NESSUS_CFG_OVERRIDE });
    result.meta  = { credentials_source: 'stored', os_type: osType };
    res.json(result);
  } catch (e) { next(e); }
}

// ── GET /nessus-status/install-config ────────────────────────────────────────
async function getInstallConfig(req, res, next) {
  try {
    const { rows } = await db.query(
      `SELECT linux_install_method, linux_file_path, linux_cmd,
              windows_method, windows_file_path, windows_cmd,
              windows_psexec_path, windows_winrm_port, windows_smb_port,
              skip_if_installed, log_file_path,
              nessus_server, nessus_port, nessus_key, nessus_groups, updated_at
         FROM nessus_install_config WHERE id = 1`,
    );
    const row = rows[0] || {};
    row.linux_file_exists     = fileCheck(row.linux_file_path);
    row.windows_file_exists   = fileCheck(row.windows_file_path);
    row.windows_psexec_exists = fileCheck(row.windows_psexec_path);
    row.log_file_exists       = fileCheck(row.log_file_path);
    res.json(row);
  } catch (e) { next(e); }
}

// ── PUT /nessus-status/install-config ────────────────────────────────────────
async function saveInstallConfig(req, res, next) {
  try {
    const {
      linux_install_method, linux_file_path, linux_cmd,
      windows_method, windows_file_path, windows_cmd,
      windows_psexec_path, windows_winrm_port, windows_smb_port,
      skip_if_installed, log_file_path,
      nessus_server, nessus_port, nessus_key, nessus_groups,
    } = req.body;

    const { rows } = await db.query(
      `INSERT INTO nessus_install_config
         (id, linux_install_method, linux_file_path, linux_cmd,
          windows_method, windows_file_path, windows_cmd,
          windows_psexec_path, windows_winrm_port, windows_smb_port,
          skip_if_installed, log_file_path,
          nessus_server, nessus_port, nessus_key, nessus_groups,
          updated_by, updated_at)
       VALUES (1, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, NOW())
       ON CONFLICT (id) DO UPDATE
         SET linux_install_method  = EXCLUDED.linux_install_method,
             linux_file_path       = EXCLUDED.linux_file_path,
             linux_cmd             = EXCLUDED.linux_cmd,
             windows_method        = EXCLUDED.windows_method,
             windows_file_path     = EXCLUDED.windows_file_path,
             windows_cmd           = EXCLUDED.windows_cmd,
             windows_psexec_path   = EXCLUDED.windows_psexec_path,
             windows_winrm_port    = EXCLUDED.windows_winrm_port,
             windows_smb_port      = EXCLUDED.windows_smb_port,
             skip_if_installed     = EXCLUDED.skip_if_installed,
             log_file_path         = EXCLUDED.log_file_path,
             nessus_server         = EXCLUDED.nessus_server,
             nessus_port           = EXCLUDED.nessus_port,
             nessus_key            = EXCLUDED.nessus_key,
             nessus_groups         = EXCLUDED.nessus_groups,
             updated_by            = EXCLUDED.updated_by,
             updated_at            = NOW()
       RETURNING linux_install_method, linux_file_path, linux_cmd,
                 windows_method, windows_file_path, windows_cmd,
                 windows_psexec_path, windows_winrm_port, windows_smb_port,
                 skip_if_installed, log_file_path,
                 nessus_server, nessus_port, nessus_key, nessus_groups, updated_at`,
      [
        linux_install_method || 'file', linux_file_path || null, linux_cmd || null,
        windows_method || 'auto', windows_file_path || null, windows_cmd || null,
        windows_psexec_path || null, windows_winrm_port || 5985, windows_smb_port || 445,
        skip_if_installed === true || skip_if_installed === 'true',
        log_file_path || null,
        nessus_server || null, nessus_port || 8834, nessus_key || null, nessus_groups || null,
        req.user.id,
      ],
    );
    const row = rows[0];
    row.linux_file_exists     = fileCheck(row.linux_file_path);
    row.windows_file_exists   = fileCheck(row.windows_file_path);
    row.windows_psexec_exists = fileCheck(row.windows_psexec_path);
    row.log_file_exists       = fileCheck(row.log_file_path);
    res.json(row);
  } catch (e) { next(e); }
}

// ── Windows: execute one method ───────────────────────────────────────────────
async function runWinMethod({ method, host, port, username, password, cfgRow, remoteDir, timeout = 300000 }) {
  const filePath = cfgRow.windows_file_path;
  const cmd      = cfgRow.windows_cmd || '';

  if (method === 'winrm') {
    return winrmInstall({ host, username, password, port: cfgRow.windows_winrm_port || 5985, filePath, remoteDir, command: cmd, timeout });
  }
  if (method === 'wmi') {
    return wmiInstall({ host, username, password, filePath, remoteDir, smbPort: cfgRow.windows_smb_port || 445, command: cmd, timeout });
  }
  if (method === 'psexec') {
    const psexecPath = cfgRow.windows_psexec_path;
    if (!psexecPath || !fs.existsSync(psexecPath)) {
      return { connected: false, error: `PsExec not found: ${psexecPath || '(not configured)'}`, output: '', exitCode: null };
    }
    return psexecInstall({ host, username, password, psexecPath, filePath, command: cmd, timeout });
  }
  // ssh / ssh_bash
  let execCmd = cmd || (filePath ? '{installer} /Silent' : '');
  if (method === 'ssh_bash') execCmd = `bash -c '${execCmd.replace(/'/g, "'\\''")}'`;
  if (filePath) {
    return sshUploadAndRun({ host, port, username, password, remoteDir, files: [{ localPath: filePath, placeholder: 'installer' }], command: execCmd, timeout });
  }
  return sshRunCommand({ host, port, username, password, command: execCmd, timeout });
}

// ── POST /nessus-status/install ───────────────────────────────────────────────
async function install(req, res, next) {
  try {
    const {
      ip_address, source, port = 22,
      windows_method_override,
    } = req.body;
    if (!ip_address || !source) throw new ApiError(400, 'ip_address and source are required');

    // Credentials always come from the asset record — no manual overrides.
    const { username, password, osType } = await resolveVm(ip_address, source);
    if (!username) return res.json({ needs_credentials: true, has_username: false, has_password: false, os_type: osType });
    if (!password) return res.json({ needs_credentials: true, has_username: true, prefill_username: username, has_password: false, os_type: osType });

    const { rows: cfg } = await db.query(
      `SELECT linux_install_method, linux_file_path, linux_cmd,
              windows_method, windows_file_path, windows_cmd,
              windows_psexec_path, windows_winrm_port, windows_smb_port,
              skip_if_installed, log_file_path
         FROM nessus_install_config WHERE id = 1`,
    );
    const cfgRow    = cfg[0] || {};
    const win       = isWindows(osType);
    const remoteDir = win ? 'C:/Windows/Temp' : '/tmp';
    const logFile   = cfgRow.log_file_path || null;

    if (cfgRow.skip_if_installed) {
      appendLog(logFile, ip_address, 'INFO', 'Checking whether Nessus Agent is already installed...');
      try {
        const vr = await sshVerify({ host: ip_address, port, username, password, osType, timeout: 14000, cfgOverride: NESSUS_CFG_OVERRIDE });
        if (vr.connected && vr.installed) {
          appendLog(logFile, ip_address, 'INFO', 'Nessus Agent already installed. Skipping deployment.');
          return res.json({ skipped: true, reason: 'Nessus Agent already installed', platform: win ? 'windows' : 'linux', os_type: osType });
        }
      } catch {}
    }

    if (win) {
      const filePath = cfgRow.windows_file_path;
      if (filePath && !fs.existsSync(filePath)) throw new ApiError(422, `Installer not found: ${filePath}`);

      const selectedMethod = windows_method_override || cfgRow.windows_method || 'auto';
      const AUTO_ORDER     = ['winrm', 'wmi', 'psexec', 'ssh', 'ssh_bash'];
      const methodsToTry   = selectedMethod === 'auto' ? AUTO_ORDER : [selectedMethod];
      const tried = [];
      let lastResult = null;

      for (const method of methodsToTry) {
        const timeout = selectedMethod === 'auto' ? 45000 : 300000;
        if (selectedMethod === 'auto') {
          appendLog(logFile, ip_address, 'INFO', `Auto mode trying ${method.toUpperCase()}`);
        }
        let r;
        try {
          r = await runWinMethod({ method, host: ip_address, port, username, password, cfgRow, remoteDir, timeout });
        } catch (e) {
          r = { connected: false, error: e.message, output: '', exitCode: null };
        }
        tried.push({ method, connected: r.connected, exitCode: r.exitCode, error: r.error || null });
        lastResult = r;

        if (r.connected && r.exitCode === 0) {
          if (selectedMethod === 'auto') {
            appendLog(logFile, ip_address, 'INFO',    `Auto mode selected ${method.toUpperCase()}`);
            appendLog(logFile, ip_address, 'SUCCESS', 'Connection test passed');
            appendLog(logFile, ip_address, 'INFO',    `Nessus deployment completed via ${method.toUpperCase()}`);
          } else {
            appendLog(logFile, ip_address, 'SUCCESS', `Nessus deployment completed via ${method.toUpperCase()}`);
          }
          return res.json({
            ...r, platform: 'windows', os_type: osType, command: cfgRow.windows_cmd || '',
            method, tried: tried.length > 1 ? tried : undefined,
            succeeded_method: selectedMethod === 'auto' ? method : undefined,
          });
        }
        if (r.error) appendLog(logFile, ip_address, 'ERROR', `${method.toUpperCase()} failed: ${r.error}`);
        if (selectedMethod !== 'auto') break;
      }

      appendLog(logFile, ip_address, 'ERROR', 'All methods exhausted. Nessus deployment failed.');
      return res.json({
        ...lastResult, platform: 'windows', os_type: osType, command: cfgRow.windows_cmd || '',
        method: methodsToTry[methodsToTry.length - 1],
        tried: tried.length > 1 ? tried : undefined,
      });
    }

    // Linux
    const linuxMethod = cfgRow.linux_install_method || 'file';
    const cmd         = cfgRow.linux_cmd || '';
    let result;

    if (linuxMethod === 'curl') {
      if (!cmd.trim()) throw new ApiError(422, 'No curl command configured for Nessus Linux install.');
      appendLog(logFile, ip_address, 'INFO', 'Linux curl install — checking curl availability...');

      // Auto-install curl if missing, then run the configured command
      const fullScript = [
        'if ! which curl >/dev/null 2>&1; then',
        '  echo "[NESSUS] curl not found, installing...";',
        '  if command -v apt-get >/dev/null 2>&1; then',
        '    sudo apt-get install -y curl;',
        '  elif command -v yum >/dev/null 2>&1; then',
        '    sudo yum install -y curl;',
        '  elif command -v dnf >/dev/null 2>&1; then',
        '    sudo dnf install -y curl;',
        '  else',
        '    echo "[ERROR] No package manager found to install curl"; exit 1;',
        '  fi;',
        '  echo "[NESSUS] curl installed successfully";',
        'fi;',
        'echo "[NESSUS] Running Nessus Agent curl install...";',
        cmd,
      ].join('\n');

      result = await sshRunCommand({ host: ip_address, port, username, password, command: fullScript });
      result.install_method = 'curl';
    } else {
      const binPath = cfgRow.linux_file_path;
      if (binPath && !fs.existsSync(binPath)) throw new ApiError(422, `Nessus installer not found: ${binPath}`);
      if (!binPath && !cmd.trim())            throw new ApiError(422, 'No Linux installer configured for Nessus.');

      if (binPath) {
        result = await sshUploadAndRun({
          host: ip_address, port, username, password, remoteDir,
          files: [{ localPath: binPath, placeholder: 'installer' }],
          command: cmd || 'chmod +x {installer} && sudo {installer} -- -y',
        });
      } else {
        result = await sshRunCommand({ host: ip_address, port, username, password, command: cmd });
      }
      result.install_method = 'file';
    }
    if (result.exitCode === 0) {
      appendLog(logFile, ip_address, 'SUCCESS', 'Nessus Agent Linux deployment completed');
    } else {
      appendLog(logFile, ip_address, 'ERROR', `Linux deployment failed (exit ${result.exitCode}): ${result.error || ''}`);
    }
    result.platform = 'linux';
    result.os_type  = osType;
    result.command  = cmd;
    res.json(result);
  } catch (e) { next(e); }
}

// ── GET /nessus-status/install-log ────────────────────────────────────────────
async function getInstallLog(req, res, next) {
  try {
    const { rows } = await db.query(`SELECT log_file_path FROM nessus_install_config WHERE id = 1`);
    const logFilePath = rows[0]?.log_file_path;
    if (!logFilePath) return res.json({ lines: [], log_file_path: null });
    if (!fs.existsSync(logFilePath)) return res.json({ lines: [], log_file_path: logFilePath, missing: true });
    const content = fs.readFileSync(logFilePath, 'utf8');
    res.json({ lines: content.split('\n').filter(Boolean), log_file_path: logFilePath });
  } catch (e) { next(e); }
}

// ── DELETE /nessus-status/install-log ────────────────────────────────────────
async function clearInstallLog(req, res, next) {
  try {
    const { rows } = await db.query(`SELECT log_file_path FROM nessus_install_config WHERE id = 1`);
    const logFilePath = rows[0]?.log_file_path;
    if (!logFilePath) throw new ApiError(400, 'No log file configured');
    if (fs.existsSync(logFilePath)) fs.writeFileSync(logFilePath, '', 'utf8');
    res.json({ cleared: true });
  } catch (e) { next(e); }
}

module.exports = { get, verify, getInstallConfig, saveInstallConfig, install, getInstallLog, clearInstallLog };
