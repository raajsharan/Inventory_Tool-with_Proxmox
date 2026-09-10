const db = require('../config/db');
const fs = require('fs');
const crypto = require('../utils/crypto');
const ansible = require('../utils/ansibleRunner');
const { ping } = require('../utils/ping');

const SOURCE_TABLE = {
  'MSL Assets':       'assets',
  'Beijing Assets':   'beijing_assets',
  'Ext. Assets':       'ext_assets',
  'Physical Servers': 'physical_esxi_servers',
};

const isWindows = (t) => /windows/i.test(t || '');

// ── candidate assets ──────────────────────────────────────────────────────
// Same eligibility filter (and me_installed flag) as Software Status —
// hypervisors/appliances can't take an agent install, and both features
// report on the same underlying ME Agent install state. physical_esxi_servers
// has no manage_engine_installed column (matches Software Status's own query).
async function listAssets() {
  const meInstalledExpr = { physical_esxi_servers: 'false' };
  const unions = Object.entries(SOURCE_TABLE).map(([source, table]) => `
    SELECT vm_name, os_hostname, ip_address::text AS ip_address,
           COALESCE(os_type, '') AS os_type,
           COALESCE(NULLIF(TRIM(location), ''), 'Unknown') AS location,
           ${meInstalledExpr[table] || 'COALESCE(manage_engine_installed, false)'} AS me_installed,
           '${source}' AS source
      FROM ${table}
     WHERE deleted_at IS NULL AND decommissioned_at IS NULL AND ip_address IS NOT NULL
  `);
  const { rows } = await db.query(`
    SELECT * FROM (${unions.join(' UNION ALL ')}) all_vms
    WHERE os_type NOT ILIKE '%esxi%' AND os_type NOT ILIKE '%vmware%'
      AND os_type NOT ILIKE '%appliance%' AND os_type NOT ILIKE '%proxmox%'
    ORDER BY location, vm_name
  `);
  return rows;
}

// ── config: default row + per-location overrides ─────────────────────────
async function getConfig() {
  const { rows } = await db.query(`SELECT * FROM test_deploy_config WHERE id = 1`);
  return rows[0] || {};
}

async function getLocationConfig(location) {
  if (!location) return null;
  const { rows } = await db.query(`SELECT * FROM test_deploy_location_config WHERE location = $1`, [location]);
  return rows[0] || null;
}

async function getMergedConfig(location) {
  const [globalCfg, locCfg] = await Promise.all([getConfig(), getLocationConfig(location)]);
  return mergeLocationConfig(globalCfg, locCfg);
}

// Every distinct asset location (so an admin can add a config for one that
// doesn't have an override yet), flagged with which ones already do —
// mirrors Software Status's own install-config/locations endpoint.
async function listLocations() {
  const [assetLocs, overrides] = await Promise.all([
    db.query(`
      SELECT DISTINCT TRIM(location) AS location FROM (
        SELECT location FROM assets                WHERE deleted_at IS NULL AND decommissioned_at IS NULL
        UNION ALL SELECT location FROM beijing_assets        WHERE deleted_at IS NULL AND decommissioned_at IS NULL
        UNION ALL SELECT location FROM ext_assets            WHERE deleted_at IS NULL AND decommissioned_at IS NULL
        UNION ALL SELECT location FROM physical_esxi_servers WHERE deleted_at IS NULL AND decommissioned_at IS NULL
      ) _l WHERE NULLIF(TRIM(location), '') IS NOT NULL
    `),
    db.query(`SELECT location FROM test_deploy_location_config`),
  ]);
  const overrideSet = new Set(overrides.rows.map(r => r.location));
  const all = new Set([...assetLocs.rows.map(r => r.location), ...overrideSet]);
  return [...all].sort().map(location => ({ location, has_override: overrideSet.has(location) }));
}

// NULL/empty override fields inherit the default — same merge rule Software
// Status uses for its own install config.
function mergeLocationConfig(globalCfg, locCfg) {
  if (!locCfg) return { ...globalCfg };
  const merged = { ...globalCfg };
  for (const [k, v] of Object.entries(locCfg)) {
    if (['location', 'updated_by', 'updated_at'].includes(k)) continue;
    if (v !== null && v !== undefined && v !== '') merged[k] = v;
  }
  return merged;
}

async function saveConfig(body, userId) {
  const {
    windows_share_path, windows_installer_file, windows_install_cmd,
    linux_share_path, linux_installer_file, linux_install_cmd,
  } = body;
  const location = (body.location || '').trim();

  if (location) {
    const { rows } = await db.query(
      `INSERT INTO test_deploy_location_config
         (location, windows_share_path, windows_installer_file, windows_install_cmd,
          linux_share_path, linux_installer_file, linux_install_cmd, updated_by, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW())
       ON CONFLICT (location) DO UPDATE SET
         windows_share_path     = EXCLUDED.windows_share_path,
         windows_installer_file = EXCLUDED.windows_installer_file,
         windows_install_cmd    = EXCLUDED.windows_install_cmd,
         linux_share_path       = EXCLUDED.linux_share_path,
         linux_installer_file   = EXCLUDED.linux_installer_file,
         linux_install_cmd      = EXCLUDED.linux_install_cmd,
         updated_by             = EXCLUDED.updated_by,
         updated_at             = NOW()
       RETURNING *`,
      [
        location, windows_share_path || null, windows_installer_file || null, windows_install_cmd || null,
        linux_share_path || null, linux_installer_file || null, linux_install_cmd || null, userId,
      ],
    );
    return rows[0];
  }

  const { rows } = await db.query(
    `INSERT INTO test_deploy_config
       (id, windows_share_path, windows_installer_file, windows_install_cmd,
        linux_share_path, linux_installer_file, linux_install_cmd, updated_by, updated_at)
     VALUES (1,$1,$2,$3,$4,$5,$6,$7,NOW())
     ON CONFLICT (id) DO UPDATE SET
       windows_share_path     = EXCLUDED.windows_share_path,
       windows_installer_file = EXCLUDED.windows_installer_file,
       windows_install_cmd    = EXCLUDED.windows_install_cmd,
       linux_share_path       = EXCLUDED.linux_share_path,
       linux_installer_file   = EXCLUDED.linux_installer_file,
       linux_install_cmd      = EXCLUDED.linux_install_cmd,
       updated_by             = EXCLUDED.updated_by,
       updated_at             = NOW()
     RETURNING *`,
    [
      windows_share_path || null, windows_installer_file || null, windows_install_cmd || null,
      linux_share_path || null, linux_installer_file || null, linux_install_cmd || null, userId,
    ],
  );
  return rows[0];
}

async function deleteLocationConfig(location) {
  await db.query(`DELETE FROM test_deploy_location_config WHERE location = $1`, [location]);
}

// ── deploy run ─────────────────────────────────────────────────────────────
async function resolveTarget({ source, ip_address }) {
  const table = SOURCE_TABLE[source];
  if (!table) return null;
  const { rows } = await db.query(
    `SELECT vm_name, asset_username, asset_password_encrypted, os_type, location
       FROM ${table} WHERE ip_address::text = $1 AND deleted_at IS NULL LIMIT 1`,
    [ip_address],
  );
  if (!rows.length) return null;
  const row = rows[0];
  let password = null;
  if (row.asset_password_encrypted) {
    try { password = crypto.decrypt(row.asset_password_encrypted); } catch {}
  }
  return {
    vm_name: row.vm_name, os_type: row.os_type || '', location: (row.location || '').trim(),
    username: row.asset_username || null, password,
  };
}

// Parses Ansible's default "PLAY RECAP" block into { host: {ok,changed,unreachable,failed} }.
function parseRecap(output) {
  const recap = {};
  let inRecap = false;
  for (const line of output.split('\n')) {
    if (/PLAY RECAP/.test(line)) { inRecap = true; continue; }
    if (!inRecap) continue;
    const m = line.match(/^(\S+)\s*:\s*ok=(\d+)\s+changed=(\d+)\s+unreachable=(\d+)\s+failed=(\d+)/);
    if (m) recap[m[1]] = { ok: +m[2], changed: +m[3], unreachable: +m[4], failed: +m[5] };
  }
  return recap;
}

// Parses the "Show OS details" debug task's output — ansible-playbook's
// default stdout callback prints registered debug messages as:
//   ok: [<host>] => {
//       "msg": "OSINFO::..."
//   }
// so this scans for that block per host and pulls the msg value out of it,
// tolerating the failed_when:false "Report OS details" task above it never
// affecting this task's own success.
function parseDebugMessages(output) {
  const messages = {};
  const lines = output.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^(?:ok|changed):\s*\[(\S+)\]\s*=>\s*\{\s*$/);
    if (!m) continue;
    const host = m[1];
    let block = '{';
    let j = i + 1;
    while (j < lines.length && lines[j].trim() !== '}') { block += lines[j] + '\n'; j++; }
    block += '}';
    try {
      const parsed = JSON.parse(block);
      if (parsed.msg) (messages[host] = messages[host] || []).push(String(parsed.msg));
    } catch {}
    i = j;
  }
  return messages;
}

// Resolves one {source, ip_address} ref into everything the playbook needs
// (credentials + effective share/installer/command config) — shared by
// startRun (bulk) and verifyTarget (single, check_only). Returns null if the
// asset record has no stored credentials.
async function buildAnsibleTarget(ref, globalCfg) {
  const t = await resolveTarget(ref);
  if (!t || !t.username || !t.password) return null;
  const locCfg = await getLocationConfig(t.location);
  const cfg = mergeLocationConfig(globalCfg, locCfg);
  const win = isWindows(t.os_type);
  return {
    source: ref.source, ip_address: ref.ip_address, vm_name: t.vm_name, os_type: t.os_type,
    isWindows: win, username: t.username, password: t.password,
    sharePath: win ? cfg.windows_share_path : cfg.linux_share_path,
    installerFile: win ? cfg.windows_installer_file : cfg.linux_installer_file,
    installCmd: win ? cfg.windows_install_cmd : cfg.linux_install_cmd,
  };
}

// ── verify: ping, host OS/version, and the file transfer step — each its
// own success/failure, none blocking the others from being reported.
async function verifyTarget(ref) {
  const pingPromise = ping(ref.ip_address);
  const globalCfg = await getConfig();
  const target = await buildAnsibleTarget(ref, globalCfg);
  if (!target) {
    return {
      connected: false, error: 'No stored username/password on the asset record.',
      ping: await pingPromise, hostInfo: null,
    };
  }

  let inventoryPath;
  try {
    inventoryPath = await ansible.writeTempInventory([target]);
    const [{ output }, pingResult] = await Promise.all([
      ansible.runPlaybook(inventoryPath, { check_only: true }),
      pingPromise,
    ]);
    const recap = parseRecap(output)[ref.ip_address];
    const connected = !!recap && recap.unreachable === 0;
    const success = connected && recap.failed === 0;
    const osMsg = (parseDebugMessages(output)[ref.ip_address] || []).find(m => m.startsWith('OSINFO::'));
    return {
      connected, error: connected ? null : 'Could not reach the host.',
      success, output,
      ping: pingResult,
      hostInfo: osMsg ? osMsg.slice('OSINFO::'.length) : null,
    };
  } catch (e) {
    return { connected: false, error: e.message, output: '', ping: await pingPromise, hostInfo: null };
  } finally {
    if (inventoryPath) fs.promises.unlink(inventoryPath).catch(() => {});
  }
}

async function executeRun(runId, targets) {
  let inventoryPath;
  try {
    inventoryPath = await ansible.writeTempInventory(targets);
    const { exitCode, output } = await ansible.runPlaybook(inventoryPath);

    const recap = parseRecap(output);
    for (const t of targets) {
      const r = recap[t.ip_address];
      const status = !r ? 'unknown' : (r.failed > 0 || r.unreachable > 0) ? 'failed' : 'success';
      await db.query(
        `UPDATE test_deploy_run_targets SET status = $1 WHERE run_id = $2 AND ip_address = $3`,
        [status, runId, t.ip_address],
      );
    }

    await db.query(
      `UPDATE test_deploy_runs SET status = $1, output = output || $2, finished_at = NOW() WHERE id = $3`,
      [exitCode === 0 ? 'completed' : 'failed', output, runId],
    );
  } catch (e) {
    await db.query(
      `UPDATE test_deploy_runs SET status = 'failed', output = output || $1, finished_at = NOW() WHERE id = $2`,
      [`\n[Test Deploy error: ${e.message}]`, runId],
    );
  } finally {
    if (inventoryPath) fs.promises.unlink(inventoryPath).catch(() => {});
  }
}

async function startRun(targetRefs, userId) {
  const globalCfg = await getConfig();
  const resolved = [];
  for (const ref of targetRefs) {
    // No stored credentials for this asset — surfaced in the run's summary
    // note below rather than failing the whole run.
    const target = await buildAnsibleTarget(ref, globalCfg);
    if (target) resolved.push(target);
  }

  const skippedCount = targetRefs.length - resolved.length;
  const initialNote = skippedCount
    ? `${skippedCount} target(s) skipped — no stored username/password on the asset record.\n`
    : '';
  const { rows: runRows } = await db.query(
    `INSERT INTO test_deploy_runs (status, output, created_by) VALUES ('running', $1, $2) RETURNING id`,
    [initialNote, userId],
  );
  const runId = runRows[0].id;

  if (resolved.length) {
    const values = resolved.map((_, i) => `($1, $${i * 4 + 2}, $${i * 4 + 3}, $${i * 4 + 4}, $${i * 4 + 5})`).join(',');
    const params = [runId];
    for (const t of resolved) params.push(t.source, t.ip_address, t.vm_name, t.os_type);
    await db.query(
      `INSERT INTO test_deploy_run_targets (run_id, source, ip_address, vm_name, os_type) VALUES ${values}`,
      params,
    );
  }

  if (!resolved.length) {
    await db.query(`UPDATE test_deploy_runs SET status = 'failed', finished_at = NOW() WHERE id = $1`, [runId]);
    return { id: runId };
  }

  // Fire-and-forget — the caller polls GET /test-deploy/runs/:id for status.
  executeRun(runId, resolved).catch(() => {});
  return { id: runId };
}

async function getRun(id) {
  const [{ rows: runRows }, { rows: targetRows }] = await Promise.all([
    db.query(`SELECT * FROM test_deploy_runs WHERE id = $1`, [id]),
    db.query(
      `SELECT source, ip_address, vm_name, os_type, status FROM test_deploy_run_targets
        WHERE run_id = $1 ORDER BY vm_name`,
      [id],
    ),
  ]);
  if (!runRows.length) return null;
  return { ...runRows[0], targets: targetRows };
}

async function listRuns() {
  const { rows } = await db.query(`
    SELECT r.id, r.status, r.created_at, r.finished_at, u.full_name AS created_by,
           COUNT(t.id)::int AS target_count
      FROM test_deploy_runs r
 LEFT JOIN users u ON u.id = r.created_by
 LEFT JOIN test_deploy_run_targets t ON t.run_id = r.id
  GROUP BY r.id, u.full_name
  ORDER BY r.created_at DESC
     LIMIT 50
  `);
  return rows;
}

module.exports = {
  listAssets, getConfig, getLocationConfig, getMergedConfig, saveConfig, deleteLocationConfig, listLocations,
  startRun, getRun, listRuns, verifyTarget,
};
