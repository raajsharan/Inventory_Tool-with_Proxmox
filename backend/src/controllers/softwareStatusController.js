const fs          = require('fs');
const path        = require('path');
const db          = require('../config/db');
const { decrypt } = require('../utils/crypto');
const {
  sshVerify, sshRunCommand, sshUploadAndRun, winrmVerify, isWindows,
} = require('../utils/sshVerify');
const { ping } = require('../utils/ping');
const { installWindowsWithFallback } = require('../utils/windowsInstallFallback');
const ansible = require('../utils/ansibleRunner');
const { installWindowsViaAnsible } = require('../utils/ansibleWindowsInstall');
const { verifyWindowsAgentViaAnsible } = require('../utils/ansibleWindowsVerify');
const { WINDOWS_CONFIG } = require('../utils/sshVerify');
const ApiError    = require('../utils/ApiError');

function appendLog(logFilePath, ip, level, message) {
  if (!logFilePath) return;
  try {
    const tag  = level === 'SUCCESS' ? '[SUCCESS]' : `[${level || 'INFO'}]`;
    const line = `${tag} ${ip}: ${message}\n`;
    fs.appendFileSync(logFilePath, line, 'utf8');
  } catch {}
}

// Many Linux agent installers (ManageEngine's UEMS_LinuxAgent.bin included)
// unpack themselves with `tar` internally and fail with an unhelpful
// "tar: command not found" deep in their own output on minimal/hardened
// distros that don't ship it by default. Best-effort: check for tar first
// and try to install it via whichever package manager is present before
// running the real installer, so the common case self-heals instead of
// wasting a full upload+run cycle on a doomed attempt. Never throws —
// if this fails (no sudo, no package manager, offline mirror, etc.) the
// real install still proceeds and surfaces its own error as before.
async function ensureTarInstalled({ host, port, username, password }) {
  const probe = [
    'if command -v tar >/dev/null 2>&1; then echo TAR_ALREADY_PRESENT; exit 0; fi',
    'if command -v apt-get >/dev/null 2>&1; then sudo -n apt-get install -y tar; exit $?; fi',
    'if command -v dnf >/dev/null 2>&1; then sudo -n dnf install -y tar; exit $?; fi',
    'if command -v yum >/dev/null 2>&1; then sudo -n yum install -y tar; exit $?; fi',
    'if command -v zypper >/dev/null 2>&1; then sudo -n zypper install -y tar; exit $?; fi',
    'if command -v apk >/dev/null 2>&1; then sudo -n apk add tar; exit $?; fi',
    'echo NO_SUPPORTED_PACKAGE_MANAGER_FOUND; exit 1',
  ].join('\n');
  try {
    return await sshRunCommand({ host, port, username, password, command: probe, timeout: 60000 });
  } catch (e) {
    return { connected: false, exitCode: null, error: e.message, output: '' };
  }
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

// ── shared: is the ME Agent present on this Windows host? ────────────────────
// Ansible first: pwsh's WSMan client can't speak NTLM to a host authenticated
// with a local admin account (MI_RESULT_FAILED, even with PSWSMan and
// gss-ntlmssp installed), while pywinrm does its own NTLM and reaches the same
// hosts fine — which is why installs already worked against hosts Live Check
// could not. winrmVerify stays as a fallback for deployments where the pwsh
// path does work, then SSH for the rare Windows host running OpenSSH instead.
async function meAgentCheckWindows({ ip_address, port = 22, username, password, osType, location }) {
  const viaAnsible = await verifyWindowsAgentViaAnsible({
    ip_address, username, password,
    serviceName: WINDOWS_CONFIG.serviceName,
    binaryPath: WINDOWS_CONFIG.binaryPath,
  });
  if (viaAnsible.connected) return viaAnsible;

  const { rows: cfg } = await db.query(`SELECT windows_winrm_port FROM software_install_config WHERE id = 1`);
  const locCfg = await getLocationConfigRow(location);
  const result = await winrmVerify({
    host: ip_address, username, password,
    port: locCfg?.windows_winrm_port || cfg[0]?.windows_winrm_port || 5985,
  });
  // Only fall back to SSH if WinRM specifically failed to connect, not if it
  // connected and just found the service/binary missing.
  if (result.connected) return result;
  const sshResult = await sshVerify({ host: ip_address, port, username, password, osType });
  return sshResult.connected ? sshResult : result;
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

    const result = isWindows(osType)
      ? await meAgentCheckWindows({ ip_address, port, username, password, osType, location })
      : await sshVerify({ host: ip_address, port, username, password, osType });

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

// ── Windows install via Ansible ───────────────────────────────────────────────
// Windows targets only — Linux ME installs stay on the SSH upload/exec paths in
// install() below and never come through here. Config is whatever install()
// already resolved, i.e. the location override merged over the default.
const ME_REMOTE_DIR = 'C:\\Temp\\MEDeploy';

function installMeWindowsViaAnsible({ ip_address, username, password, cfgRow, osType, logFile }) {
  const filePath = cfgRow.windows_file_path;
  if (!filePath) {
    return Promise.resolve({
      connected: false, error: 'No Windows installer path is configured.', output: '', exitCode: null,
      platform: 'windows', os_type: osType, method: 'ansible',
    });
  }

  // {installer} is resolved here rather than in the playbook, since only this
  // side knows where win_copy will land the file — the same substitution the
  // WinRM/WMI/PsExec transports do against their own remote dir.
  const remotePath = `${ME_REMOTE_DIR}\\${path.basename(filePath)}`;
  const command = (cfgRow.windows_cmd || `& '{installer}' /Silent`)
    .replace(/\{installer\}/g, remotePath);

  return installWindowsViaAnsible({
    ip_address, username, password, osType,
    playbookPath: ansible.ME_WINDOWS_PLAYBOOK,
    playbookName: 'me_agent_windows.yml',
    vars: { me_source: filePath, me_install_cmd: command },
    command,
    appendLog, logFile, agentLabel: 'ManageEngine Agent',
  });
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
        // Same check Live Check runs — an SSH-only check can't connect to a
        // host with no SSH server, so it could never confirm an existing
        // agent and the skip silently never happened.
        const vResult = isWindows(osType)
          ? await meAgentCheckWindows({ ip_address, port, username, password, osType, location })
          : await sshVerify({ host: ip_address, port, username, password, osType, timeout: 14000 });
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

      // Kept here rather than in windowsInstallFallback.js's AUTO_ORDER —
      // that chain is shared with Nessus Agent Status, which runs a different
      // playbook, so each page owns where Ansible sits in its own ordering.
      const selectedMethod = windows_method_override || cfgRow.windows_method || 'auto';
      if (selectedMethod === 'ansible' || selectedMethod === 'auto') {
        const r = await installMeWindowsViaAnsible({ ip_address, username, password, cfgRow, osType, logFile });
        if (selectedMethod === 'ansible') return res.json(r);
        if (r.connected && r.exitCode === 0) return res.json({ ...r, succeeded_method: 'ansible' });
        appendLog(logFile, ip_address, 'INFO',
          `Auto mode: Ansible did not succeed (${r.error || `exit ${r.exitCode}`}) — falling back to WinRM → WMI → PsExec → SSH`);
      }

      const result = await installWindowsWithFallback({
        ip_address, port, username, password, cfgRow, remoteDir, osType,
        windows_method_override, appendLog, logFile, agentLabel: 'ManageEngine Agent',
      });
      return res.json(result);
    }

    // ── Linux ──────────────────────────────────────────────────────────────────
    const binPath  = cfgRow.linux_file_path;
    const infoPath = cfgRow.linux_serverinfo_path;
    const cmd      = cfgRow.linux_cmd || '';

    if (binPath  && !fs.existsSync(binPath))  throw new ApiError(422, `Linux installer not found: ${binPath}`);
    if (infoPath && !fs.existsSync(infoPath)) throw new ApiError(422, `serverinfo.json not found: ${infoPath}`);
    if (!binPath && !cmd.trim())              throw new ApiError(422, 'No Linux installer configured.');

    // The agent registers itself in ManageEngine under the machine's own
    // hostname, so a host left at the RHEL-family default would enroll as
    // localhost.localdomain and collide with every other unnamed host.
    // Read live rather than from os_hostname on the record, because the live
    // value is the one the agent will actually use. -f first: an unnamed box
    // answers "localhost" to a bare hostname but "localhost.localdomain" to
    // the FQDN form. If the probe itself can't connect, it is not treated as
    // a failed check — the install below will report the real error.
    appendLog(logFile, ip_address, 'INFO', 'Checking the host has a real hostname before installing...');
    const hostnameProbe = await sshRunCommand({
      host: ip_address, port, username, password,
      command: 'hostname -f 2>/dev/null || hostname',
      timeout: 15000,
    });
    const liveHostname = (hostnameProbe.output || '').trim();
    if (liveHostname.toLowerCase() === 'localhost.localdomain') {
      const reason = `Refusing to install: this host still reports its hostname as "${liveHostname}". `
        + 'The ME Agent registers under the machine\'s hostname, so it would enroll as '
        + 'localhost.localdomain and collide with every other unnamed host. Give the machine a '
        + 'real hostname, then run this again.';
      appendLog(logFile, ip_address, 'ERROR', reason);
      return res.json({
        connected: true, error: reason, output: liveHostname, exitCode: 1,
        platform: 'linux', os_type: osType, hostname_rejected: true,
      });
    }

    if (binPath) {
      const tarCheck = await ensureTarInstalled({ host: ip_address, port, username, password });
      if (/TAR_ALREADY_PRESENT/.test(tarCheck.output || '')) {
        appendLog(logFile, ip_address, 'INFO', 'tar already present');
      } else if (tarCheck.exitCode === 0) {
        appendLog(logFile, ip_address, 'INFO', 'tar was missing — installed it automatically before running the agent installer');
      } else {
        appendLog(logFile, ip_address, 'WARN', `Could not confirm/install tar (${tarCheck.error || tarCheck.output || 'unknown reason'}) — proceeding with install anyway`);
      }
    }

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
