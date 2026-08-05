const fs          = require('fs');
const path        = require('path');
const db          = require('../config/db');
const { decrypt } = require('../utils/crypto');
const {
  sshVerify, sshRunCommand, sshUploadAndRun, isWindows,
  WINDOWS_CONFIG, parseWindowsService, SEP,
} = require('../utils/sshVerify');
const { ping } = require('../utils/ping');
const { winrmInstall, psexecInstall, wmiInstall }              = require('../utils/winInstall');
const ApiError    = require('../utils/ApiError');

function appendLog(logFilePath, ip, level, message) {
  if (!logFilePath) return;
  try {
    const tag  = level === 'SUCCESS' ? '[SUCCESS]' : `[${level || 'INFO'}]`;
    const line = `${tag} ${ip}: ${message}\n`;
    fs.appendFileSync(logFilePath, line, 'utf8');
  } catch {}
}

const SOURCE_TABLE = {
  'MSL Assets':      'assets',
  'Beijing Assets':  'beijing_assets',
  'Ext. Assets':     'ext_assets',
  'Physical Servers':'physical_esxi_servers',
};

// ── shared: resolve credentials for a VM ─────────────────────────────────────
async function resolveVm(ip_address, source, override_username, override_password) {
  const table = SOURCE_TABLE[source];
  if (!table) throw new ApiError(400, 'Unknown source: ' + source);

  const { rows } = await db.query(
    `SELECT asset_username, asset_password_encrypted, os_type, location
       FROM ${table}
      WHERE ip_address::text = $1
        AND deleted_at IS NULL
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

  return { username, password, osType, location: (row.location || '').trim() };
}

// Merge a location override row over the global config — NULL/empty override
// fields inherit the global value.
function mergeLocationConfig(globalCfg, locCfg) {
  if (!locCfg) return { ...globalCfg, config_source: 'default' };
  const merged = { ...globalCfg };
  for (const [k, v] of Object.entries(locCfg)) {
    if (k === 'location' || k === 'updated_by' || k === 'updated_at') continue;
    if (v !== null && v !== undefined && v !== '') merged[k] = v;
  }
  merged.config_source = `location:${locCfg.location}`;
  return merged;
}

// Checks the ManageEngine service + binary over WinRM instead of SSH — most
// Windows hosts don't run an SSH server, so sshVerify alone would report
// "Unreachable" for a perfectly healthy, pingable Windows machine (it was
// only ever testing whether SSH specifically was open, not the host itself).
async function winrmVerify({ host, username, password, port, cfg = WINDOWS_CONFIG }) {
  const svcName = cfg.serviceName.replace(/'/g, "''");
  const binPath = cfg.binaryPath.replace(/'/g, "''");
  const script = [
    `$svc = Get-Service '${svcName}' -ErrorAction SilentlyContinue`,
    `if ($svc) { Write-Output $svc.Status.ToString() } else { Write-Output 'NOT_FOUND' }`,
    `Write-Output '${SEP}'`,
    `if (Test-Path '${binPath}') { Write-Output 'FILE_EXISTS' } else { Write-Output 'FILE_NOT_FOUND' }`,
  ].join('; ');

  const r = await winrmInstall({ host, username, password, port: port || 5985, command: script, timeout: 15000 });
  if (!r.connected) {
    return { connected: false, error: r.error, service: null, file: null, platform: 'windows' };
  }

  const raw     = r.output || '';
  const sepIdx  = raw.indexOf(SEP);
  const svcRaw  = (sepIdx >= 0 ? raw.slice(0, sepIdx) : raw).trim();
  const fileRaw = (sepIdx >= 0 ? raw.slice(sepIdx + SEP.length) : '').trim();
  const serviceStatus = parseWindowsService(svcRaw);
  const fileExists    = fileRaw.includes('FILE_EXISTS');

  return {
    connected: true,
    error: null,
    service: { status: serviceStatus, output: svcRaw, name: cfg.serviceName },
    file:    { exists: fileExists, path: cfg.binaryPath },
    installed: serviceStatus === 'running' || fileExists,
    platform: 'windows',
  };
}

async function getLocationConfigRow(location) {
  if (!location) return null;
  const { rows } = await db.query(
    `SELECT * FROM software_install_location_config WHERE location = $1`,
    [location],
  );
  return rows[0] || null;
}

// ── GET /software-status ─────────────────────────────────────────────────────
async function get(req, res, next) {
  try {
    const sql = `
      WITH all_vms AS (
        SELECT COALESCE(NULLIF(TRIM(location), ''), 'Unknown') AS location,
               vm_name, os_hostname, ip_address::text AS ip_address,
               server_status,
               COALESCE(manage_engine_installed, false) AS me_installed,
               COALESCE(os_type, '') AS os_type,
               'MSL Assets' AS source,
               asset_username
          FROM assets
         WHERE deleted_at IS NULL AND decommissioned_at IS NULL
        UNION ALL
        SELECT COALESCE(NULLIF(TRIM(location), ''), 'Unknown'),
               vm_name, os_hostname, ip_address::text, server_status,
               COALESCE(manage_engine_installed, false), COALESCE(os_type, ''), 'Beijing Assets',
               asset_username
          FROM beijing_assets
         WHERE deleted_at IS NULL AND decommissioned_at IS NULL
        UNION ALL
        SELECT COALESCE(NULLIF(TRIM(location), ''), 'Unknown'),
               vm_name, os_hostname, ip_address::text, server_status,
               COALESCE(manage_engine_installed, false), COALESCE(os_type, ''), 'Ext. Assets',
               asset_username
          FROM ext_assets
         WHERE deleted_at IS NULL AND decommissioned_at IS NULL
        UNION ALL
        SELECT COALESCE(NULLIF(TRIM(location), ''), 'Unknown'),
               vm_name, os_hostname, ip_address::text, server_status,
               false, COALESCE(os_type, ''), 'Physical Servers',
               asset_username
          FROM physical_esxi_servers
         WHERE deleted_at IS NULL AND decommissioned_at IS NULL
      )
      SELECT location,
        COUNT(*)::int                                                   AS total,
        SUM(CASE WHEN me_installed     THEN 1 ELSE 0 END)::int         AS installed,
        SUM(CASE WHEN NOT me_installed THEN 1 ELSE 0 END)::int         AS not_installed,
        ROUND(SUM(CASE WHEN me_installed THEN 1 ELSE 0 END)*100.0/NULLIF(COUNT(*),0),1) AS compliance_pct,
        JSON_AGG(JSON_BUILD_OBJECT(
          'vm_name',vm_name,'os_hostname',os_hostname,'ip_address',ip_address,
          'server_status',server_status,'me_installed',me_installed,'os_type',os_type,'source',source,
          'asset_username',asset_username
        ) ORDER BY me_installed, vm_name) AS vms
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
    const overall = rows.reduce(
      (a, r) => { a.total += r.total; a.installed += r.installed; a.not_installed += r.not_installed; return a; },
      { total: 0, installed: 0, not_installed: 0 },
    );
    overall.compliance_pct = overall.total
      ? Math.round((overall.installed / overall.total) * 1000) / 10 : 0;
    res.json({ locations: rows, overall });
  } catch (e) { next(e); }
}

// ── POST /software-status/verify ─────────────────────────────────────────────
//    Credentials always come from the asset record — no manual overrides.
async function verify(req, res, next) {
  try {
    const { ip_address, source, port = 22 } = req.body;
    if (!ip_address || !source) throw new ApiError(400, 'ip_address and source are required');

    const [{ username, password, osType, location }, pingResult] = await Promise.all([
      resolveVm(ip_address, source),
      ping(ip_address),
    ]);

    if (!username) return res.json({ needs_credentials: true, has_username: false, has_password: false, os_type: osType, ping: pingResult });
    if (!password) return res.json({ needs_credentials: true, has_username: true, prefill_username: username, has_password: false, os_type: osType, ping: pingResult });

    let result;
    if (isWindows(osType)) {
      const { rows: cfg } = await db.query(`SELECT windows_winrm_port FROM software_install_config WHERE id = 1`);
      const locCfg = await getLocationConfigRow(location);
      const winrmPort = locCfg?.windows_winrm_port || cfg[0]?.windows_winrm_port || 5985;

      result = await winrmVerify({ host: ip_address, username, password, port: winrmPort });
      // A handful of Windows hosts run OpenSSH instead of WinRM — only fall
      // back to SSH if WinRM specifically failed to connect, not if it
      // connected and just found the service/binary missing.
      if (!result.connected) {
        const sshResult = await sshVerify({ host: ip_address, port, username, password, osType });
        if (sshResult.connected) result = sshResult;
      }
    } else {
      result = await sshVerify({ host: ip_address, port, username, password, osType });
    }

    result.ping = pingResult;
    result.meta = { credentials_source: 'stored', os_type: osType };
    res.json(result);
  } catch (e) { next(e); }
}

const fileCheck = (p) => { if (!p) return null; try { return fs.existsSync(p); } catch { return false; } };

function attachFileChecks(row) {
  row.linux_file_exists        = fileCheck(row.linux_file_path);
  row.linux_serverinfo_exists  = fileCheck(row.linux_serverinfo_path);
  row.windows_file_exists      = fileCheck(row.windows_file_path);
  row.windows_psexec_exists    = fileCheck(row.windows_psexec_path);
  if ('log_file_path' in row) row.log_file_exists = fileCheck(row.log_file_path);
  return row;
}

// ── GET /software-status/install-config ──────────────────────────────────────
//    ?location=X            → that location's override row (empty if none)
//    ?location=X&merged=true → the effective config (override merged over default)
async function getInstallConfig(req, res, next) {
  try {
    const location = (req.query.location || '').trim();
    const merged   = String(req.query.merged || '') === 'true';
    if (location && !merged) {
      const locRow = await getLocationConfigRow(location);
      return res.json(attachFileChecks(locRow ? { ...locRow } : { location, exists: false }));
    }
    const { rows } = await db.query(
      `SELECT linux_file_path, linux_serverinfo_path, linux_cmd,
              windows_method, windows_file_path, windows_cmd,
              windows_psexec_path, windows_winrm_port, windows_smb_port,
              skip_if_installed, log_file_path, updated_at
         FROM software_install_config WHERE id = 1`,
    );
    const globalCfg = rows[0] || {};
    if (location && merged) {
      const locRow = await getLocationConfigRow(location);
      return res.json(attachFileChecks(mergeLocationConfig(globalCfg, locRow)));
    }
    res.json(attachFileChecks(globalCfg));
  } catch (e) { next(e); }
}

// ── GET /software-status/install-config/locations ────────────────────────────
//    All distinct asset locations + which ones have a custom ME config.
async function getInstallConfigLocations(req, res, next) {
  try {
    const [locs, overrides] = await Promise.all([
      db.query(`
        SELECT DISTINCT TRIM(location) AS location FROM (
          SELECT location FROM assets                WHERE deleted_at IS NULL AND decommissioned_at IS NULL
          UNION ALL SELECT location FROM beijing_assets        WHERE deleted_at IS NULL AND decommissioned_at IS NULL
          UNION ALL SELECT location FROM ext_assets            WHERE deleted_at IS NULL AND decommissioned_at IS NULL
          UNION ALL SELECT location FROM physical_esxi_servers WHERE deleted_at IS NULL AND decommissioned_at IS NULL
        ) _l WHERE NULLIF(TRIM(location), '') IS NOT NULL
        ORDER BY 1`),
      db.query(`SELECT location, updated_at FROM software_install_location_config ORDER BY location`),
    ]);
    const overrideSet = new Set(overrides.rows.map(r => r.location));
    // Include override rows whose location no longer has assets, so they stay manageable.
    const all = new Set([...locs.rows.map(r => r.location), ...overrideSet]);
    res.json({
      locations: [...all].sort().map(l => ({ location: l, has_override: overrideSet.has(l) })),
    });
  } catch (e) { next(e); }
}

// ── DELETE /software-status/install-config?location=X ────────────────────────
async function deleteLocationConfig(req, res, next) {
  try {
    const location = (req.query.location || req.body?.location || '').trim();
    if (!location) throw new ApiError(400, 'location is required');
    await db.query(`DELETE FROM software_install_location_config WHERE location = $1`, [location]);
    res.json({ deleted: true, location });
  } catch (e) { next(e); }
}

// ── PUT /software-status/install-config ──────────────────────────────────────
//    body.location set → upsert that location's override row instead.
async function saveInstallConfig(req, res, next) {
  try {
    const {
      linux_file_path, linux_serverinfo_path, linux_cmd,
      windows_method, windows_file_path, windows_cmd,
      windows_psexec_path, windows_winrm_port, windows_smb_port,
      skip_if_installed, log_file_path,
    } = req.body;

    const location = (req.body.location || '').trim();
    if (location) {
      const { rows } = await db.query(
        `INSERT INTO software_install_location_config
           (location, linux_file_path, linux_serverinfo_path, linux_cmd,
            windows_method, windows_file_path, windows_cmd,
            windows_psexec_path, windows_winrm_port, windows_smb_port,
            updated_by, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NOW())
         ON CONFLICT (location) DO UPDATE
           SET linux_file_path       = EXCLUDED.linux_file_path,
               linux_serverinfo_path = EXCLUDED.linux_serverinfo_path,
               linux_cmd             = EXCLUDED.linux_cmd,
               windows_method        = EXCLUDED.windows_method,
               windows_file_path     = EXCLUDED.windows_file_path,
               windows_cmd           = EXCLUDED.windows_cmd,
               windows_psexec_path   = EXCLUDED.windows_psexec_path,
               windows_winrm_port    = EXCLUDED.windows_winrm_port,
               windows_smb_port      = EXCLUDED.windows_smb_port,
               updated_by            = EXCLUDED.updated_by,
               updated_at            = NOW()
         RETURNING *`,
        [
          location,
          linux_file_path || null, linux_serverinfo_path || null, linux_cmd || null,
          windows_method || null, windows_file_path || null, windows_cmd || null,
          windows_psexec_path || null,
          windows_winrm_port || null, windows_smb_port || null,
          req.user.id,
        ],
      );
      return res.json(attachFileChecks({ ...rows[0] }));
    }
    const { rows } = await db.query(
      `INSERT INTO software_install_config
         (id, linux_file_path, linux_serverinfo_path, linux_cmd,
          windows_method, windows_file_path, windows_cmd,
          windows_psexec_path, windows_winrm_port, windows_smb_port,
          skip_if_installed, log_file_path, updated_by, updated_at)
       VALUES (1, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW())
       ON CONFLICT (id) DO UPDATE
         SET linux_file_path        = EXCLUDED.linux_file_path,
             linux_serverinfo_path  = EXCLUDED.linux_serverinfo_path,
             linux_cmd              = EXCLUDED.linux_cmd,
             windows_method         = EXCLUDED.windows_method,
             windows_file_path      = EXCLUDED.windows_file_path,
             windows_cmd            = EXCLUDED.windows_cmd,
             windows_psexec_path    = EXCLUDED.windows_psexec_path,
             windows_winrm_port     = EXCLUDED.windows_winrm_port,
             windows_smb_port       = EXCLUDED.windows_smb_port,
             skip_if_installed      = EXCLUDED.skip_if_installed,
             log_file_path          = EXCLUDED.log_file_path,
             updated_by             = EXCLUDED.updated_by,
             updated_at             = NOW()
       RETURNING linux_file_path, linux_serverinfo_path, linux_cmd,
                 windows_method, windows_file_path, windows_cmd,
                 windows_psexec_path, windows_winrm_port, windows_smb_port,
                 skip_if_installed, log_file_path, updated_at`,
      [
        linux_file_path || null, linux_serverinfo_path || null, linux_cmd || null,
        windows_method || 'auto', windows_file_path || null, windows_cmd || null,
        windows_psexec_path || null, windows_winrm_port || 5985, windows_smb_port || 445,
        skip_if_installed === true || skip_if_installed === 'true', log_file_path || null, req.user.id,
      ],
    );
    res.json(attachFileChecks(rows[0]));
  } catch (e) { next(e); }
}

// ── Windows: execute one method ───────────────────────────────────────────────
async function runWinMethod({ method, host, port, username, password, cfgRow, remoteDir, timeout = 300000 }) {
  const filePath = cfgRow.windows_file_path;
  const cmd      = cfgRow.windows_cmd || '';

  if (method === 'winrm') {
    return winrmInstall({
      host, username, password,
      port:    cfgRow.windows_winrm_port || 5985,
      filePath: filePath || null,
      remoteDir,
      command: cmd || (filePath ? `& '{installer}' /Silent` : ''),
      timeout,
    });
  }

  if (method === 'wmi') {
    return wmiInstall({
      host, username, password,
      filePath: filePath || null,
      remoteDir,
      smbPort: cfgRow.windows_smb_port || 445,
      command: cmd || (filePath ? '{installer} /Silent' : ''),
      timeout,
    });
  }

  if (method === 'psexec') {
    const psexecPath = cfgRow.windows_psexec_path;
    if (!psexecPath || !fs.existsSync(psexecPath)) {
      return { connected: false, error: `PsExec not found: ${psexecPath || '(not configured)'}`, output: '', exitCode: null };
    }
    return psexecInstall({ host, username, password, psexecPath, filePath, command: cmd, timeout });
  }

  // ssh or ssh_bash
  let execCmd = cmd || (filePath ? '{installer} /Silent' : '');
  if (method === 'ssh_bash') {
    execCmd = `bash -c '${execCmd.replace(/'/g, "'\\''")}'`;
  }
  if (filePath) {
    return sshUploadAndRun({
      host, port, username, password, remoteDir,
      files: [{ localPath: filePath, placeholder: 'installer' }],
      command: execCmd, timeout,
    });
  }
  return sshRunCommand({ host, port, username, password, command: execCmd, timeout });
}

// ── POST /software-status/install ─────────────────────────────────────────────
async function install(req, res, next) {
  try {
    const {
      ip_address, source, port = 22,
      windows_method_override,          // 'ssh' | 'ssh_bash' | 'winrm' | 'psexec' | 'auto' | undefined
    } = req.body;
    if (!ip_address || !source) throw new ApiError(400, 'ip_address and source are required');

    // Credentials always come from the asset record — no manual overrides.
    const { username, password, osType, location } = await resolveVm(ip_address, source);

    if (!username) return res.json({ needs_credentials: true, has_username: false, has_password: false, os_type: osType });
    if (!password) return res.json({ needs_credentials: true, has_username: true, prefill_username: username, has_password: false, os_type: osType });

    // Load config — the VM's location override (if any) merged over the default
    const { rows: cfg } = await db.query(
      `SELECT linux_file_path, linux_serverinfo_path, linux_cmd,
              windows_method, windows_file_path, windows_cmd,
              windows_psexec_path, windows_winrm_port, windows_smb_port,
              skip_if_installed, log_file_path
         FROM software_install_config WHERE id = 1`,
    );
    const locCfg    = await getLocationConfigRow(location);
    const cfgRow    = mergeLocationConfig(cfg[0] || {}, locCfg);
    const win       = isWindows(osType);
    const remoteDir = win ? 'C:/Windows/Temp' : '/tmp';
    const logFile   = cfgRow.log_file_path || null;
    if (locCfg) appendLog(logFile, ip_address, 'INFO', `Using "${location}" location installer configuration`);

    // Skip if agent already installed
    if (cfgRow.skip_if_installed) {
      appendLog(logFile, ip_address, 'INFO', 'Checking whether agent is already installed...');
      try {
        const vResult = await sshVerify({ host: ip_address, port, username, password, osType, timeout: 14000 });
        if (vResult.connected && vResult.installed) {
          appendLog(logFile, ip_address, 'INFO', 'Agent already installed. Skipping deployment.');
          return res.json({ skipped: true, reason: 'Agent already installed', platform: win ? 'windows' : 'linux', os_type: osType });
        }
      } catch {}
    }

    // ── Windows ────────────────────────────────────────────────────────────────
    if (win) {
      const filePath = cfgRow.windows_file_path;
      if (filePath && !fs.existsSync(filePath)) {
        throw new ApiError(422, `Installer not found on server: ${filePath}`);
      }

      // Resolve which method(s) to try
      const selectedMethod = windows_method_override || cfgRow.windows_method || 'ssh';
      const AUTO_ORDER     = ['winrm', 'wmi', 'psexec', 'ssh', 'ssh_bash'];
      const methodsToTry   = selectedMethod === 'auto' ? AUTO_ORDER : [selectedMethod];

      const tried = [];
      let lastResult = null;

      for (const method of methodsToTry) {
        const timeout = selectedMethod === 'auto' ? 45000 : 300000;
        if (selectedMethod === 'auto') {
          const portHint = method === 'winrm' ? ` on port ${cfgRow.windows_winrm_port || 5985}` : '';
          appendLog(logFile, ip_address, 'INFO', `Auto mode trying ${method.toUpperCase()}${portHint}`);
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
            appendLog(logFile, ip_address, 'INFO',    `Auto mode completed deployment via ${method.toUpperCase()}`);
          } else {
            appendLog(logFile, ip_address, 'SUCCESS', `Deployment completed via ${method.toUpperCase()}`);
          }
          return res.json({
            ...r,
            platform: 'windows', os_type: osType, command: cfgRow.windows_cmd || '',
            method, tried: tried.length > 1 ? tried : undefined,
            succeeded_method: selectedMethod === 'auto' ? method : undefined,
          });
        }
        if (r.error) appendLog(logFile, ip_address, 'ERROR', `${method.toUpperCase()} failed: ${r.error}`);

        // If not auto mode, stop after first attempt
        if (selectedMethod !== 'auto') break;
      }

      appendLog(logFile, ip_address, 'ERROR', 'All methods exhausted. Deployment failed.');
      // All attempts exhausted
      return res.json({
        ...lastResult,
        platform: 'windows', os_type: osType, command: cfgRow.windows_cmd || '',
        method: methodsToTry[methodsToTry.length - 1],
        tried: tried.length > 1 ? tried : undefined,
      });
    }

    // ── Linux ──────────────────────────────────────────────────────────────────
    const binPath  = cfgRow.linux_file_path;
    const infoPath = cfgRow.linux_serverinfo_path;
    const cmd      = cfgRow.linux_cmd || '';

    if (binPath  && !fs.existsSync(binPath))  throw new ApiError(422, `Linux installer not found: ${binPath}`);
    if (infoPath && !fs.existsSync(infoPath)) throw new ApiError(422, `serverinfo.json not found: ${infoPath}`);
    if (!binPath && !cmd.trim())              throw new ApiError(422, 'No Linux installer configured.');

    let result;
    if (binPath) {
      const files = [{ localPath: binPath, placeholder: 'installer' }];
      if (infoPath) files.unshift({ localPath: infoPath, placeholder: 'serverinfo' });
      result = await sshUploadAndRun({
        host: ip_address, port, username, password, remoteDir, files,
        command: cmd || 'chmod +x {installer} && sudo {installer} --silent',
      });
    } else {
      result = await sshRunCommand({ host: ip_address, port, username, password, command: cmd });
    }
    if (result.exitCode === 0) {
      appendLog(logFile, ip_address, 'SUCCESS', 'Linux deployment completed');
    } else {
      appendLog(logFile, ip_address, 'ERROR', `Linux deployment failed (exit ${result.exitCode ?? 'null'}): ${result.error || ''}`);
    }
    result.platform = 'linux';
    result.os_type  = osType;
    result.command  = cmd;
    res.json(result);
  } catch (e) { next(e); }
}

// ── GET /software-status/install-log ─────────────────────────────────────────
async function getInstallLog(req, res, next) {
  try {
    const { rows } = await db.query(`SELECT log_file_path FROM software_install_config WHERE id = 1`);
    const logFilePath = rows[0]?.log_file_path;
    if (!logFilePath) return res.json({ lines: [], log_file_path: null });
    if (!fs.existsSync(logFilePath)) return res.json({ lines: [], log_file_path: logFilePath, missing: true });
    const content = fs.readFileSync(logFilePath, 'utf8');
    const lines   = content.split('\n').filter(Boolean);
    res.json({ lines, log_file_path: logFilePath });
  } catch (e) { next(e); }
}

// ── DELETE /software-status/install-log ──────────────────────────────────────
async function clearInstallLog(req, res, next) {
  try {
    const { rows } = await db.query(`SELECT log_file_path FROM software_install_config WHERE id = 1`);
    const logFilePath = rows[0]?.log_file_path;
    if (!logFilePath) throw new ApiError(400, 'No log file configured');
    if (fs.existsSync(logFilePath)) fs.writeFileSync(logFilePath, '', 'utf8');
    res.json({ cleared: true });
  } catch (e) { next(e); }
}

module.exports = {
  get, verify, getInstallConfig, saveInstallConfig, install, getInstallLog, clearInstallLog,
  getInstallConfigLocations, deleteLocationConfig,
};
