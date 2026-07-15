/**
 * hypervDbService.js
 * ------------------
 * All PostgreSQL operations for Microsoft Hyper-V discovery data.
 */

const db     = require('../config/db');
const crypto = require('../utils/crypto');

// ---------------------------------------------------------------------------
// Hosts
// ---------------------------------------------------------------------------

async function listHosts() {
  const { rows } = await db.query(
    `SELECT id, host, display_name, username, port, use_ssl, verify_ssl,
            interval_minutes, scheduler_enabled, last_discovery_at, last_vm_count,
            is_running, created_at, updated_at
     FROM hyperv_hosts ORDER BY host`
  );
  return rows;
}

async function getHostById(id) {
  const { rows } = await db.query('SELECT * FROM hyperv_hosts WHERE id = $1', [id]);
  return rows[0] || null;
}

async function upsertHost({ host, displayName, username, password, port, useSSL, verifySSL, intervalMinutes, schedulerEnabled }) {
  const passwordEnc = password ? crypto.encrypt(password) : null;
  const { rows } = await db.query(
    `INSERT INTO hyperv_hosts
       (host, display_name, username, password_encrypted, port, use_ssl, verify_ssl, interval_minutes, scheduler_enabled)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     ON CONFLICT (host) DO UPDATE SET
       display_name       = EXCLUDED.display_name,
       username           = EXCLUDED.username,
       password_encrypted = COALESCE(EXCLUDED.password_encrypted, hyperv_hosts.password_encrypted),
       port               = EXCLUDED.port,
       use_ssl            = EXCLUDED.use_ssl,
       verify_ssl         = EXCLUDED.verify_ssl,
       interval_minutes   = EXCLUDED.interval_minutes,
       scheduler_enabled  = EXCLUDED.scheduler_enabled,
       updated_at         = NOW()
     RETURNING id, host, display_name, username, port, use_ssl, verify_ssl,
               interval_minutes, scheduler_enabled, last_discovery_at, last_vm_count, is_running`,
    [host, displayName || null, username, passwordEnc, port || 5985, !!useSSL, !!verifySSL, intervalMinutes || 60, !!schedulerEnabled]
  );
  return rows[0];
}

async function updateHostById(id, fields) {
  const { host, displayName, username, password, port, useSSL, verifySSL, intervalMinutes, schedulerEnabled } = fields;
  const passwordEnc = password ? crypto.encrypt(password) : null;
  const { rows } = await db.query(
    `UPDATE hyperv_hosts SET
       host               = COALESCE($2, host),
       display_name       = $3,
       username           = COALESCE($4, username),
       password_encrypted = COALESCE($5, password_encrypted),
       port               = COALESCE($6, port),
       use_ssl            = COALESCE($7, use_ssl),
       verify_ssl         = COALESCE($8, verify_ssl),
       interval_minutes   = COALESCE($9, interval_minutes),
       scheduler_enabled  = COALESCE($10, scheduler_enabled),
       updated_at         = NOW()
     WHERE id = $1
     RETURNING id, host, display_name, username, port, use_ssl, verify_ssl,
               interval_minutes, scheduler_enabled, last_discovery_at, last_vm_count, is_running`,
    [id, host || null, displayName || null, username || null, passwordEnc,
     port || null, useSSL !== undefined ? !!useSSL : null,
     verifySSL !== undefined ? !!verifySSL : null,
     intervalMinutes || null, schedulerEnabled !== undefined ? !!schedulerEnabled : null]
  );
  return rows[0] || null;
}

async function deleteHost(id) {
  const { rowCount } = await db.query('DELETE FROM hyperv_hosts WHERE id = $1', [id]);
  return rowCount > 0;
}

async function setHostRunning(id, running) {
  await db.query('UPDATE hyperv_hosts SET is_running = $2, updated_at = NOW() WHERE id = $1', [id, running]);
}

async function setLastDiscovery(id, vmCount) {
  await db.query(
    'UPDATE hyperv_hosts SET last_discovery_at = NOW(), last_vm_count = $2, is_running = FALSE, updated_at = NOW() WHERE id = $1',
    [id, vmCount]
  );
}

function getDecryptedPassword(host) {
  return host.password_encrypted ? crypto.decrypt(host.password_encrypted) : null;
}

// ---------------------------------------------------------------------------
// Discovery runs
// ---------------------------------------------------------------------------

async function startRun(hostId, sourceHost) {
  const { rows } = await db.query(
    `INSERT INTO hyperv_discovery_runs (host_id, source_host, status) VALUES ($1, $2, 'running') RETURNING id`,
    [hostId, sourceHost]
  );
  return rows[0].id;
}

async function finishRun(runId, vmCount) {
  await db.query(
    `UPDATE hyperv_discovery_runs SET status = 'success', vm_count = $2 WHERE id = $1`,
    [runId, vmCount]
  );
}

async function failRun(runId, errorMessage) {
  await db.query(
    `UPDATE hyperv_discovery_runs SET status = 'error', error_message = $2 WHERE id = $1`,
    [runId, errorMessage]
  );
}

async function getRunHistory(hostId, limit = 20) {
  const params = [limit];
  let where = '';
  if (hostId) { params.unshift(hostId); where = 'WHERE r.host_id = $1'; }
  const { rows } = await db.query(
    `SELECT r.id, r.source_host, r.vm_count, r.status, r.error_message, r.run_at, h.host, h.display_name
     FROM hyperv_discovery_runs r
     JOIN hyperv_hosts h ON h.id = r.host_id
     ${where}
     ORDER BY r.run_at DESC LIMIT $${params.length}`,
    params
  );
  return rows;
}

// ---------------------------------------------------------------------------
// VM records
// ---------------------------------------------------------------------------

async function saveVMs(runId, hostId, sourceHost, vms) {
  if (!vms.length) return;
  const values = [];
  const params = [];
  let i = 1;
  for (const vm of vms) {
    values.push(
      `($${i++},$${i++},$${i++},$${i++},$${i++},$${i++},$${i++},$${i++},$${i++},$${i++},$${i++},$${i++},$${i++},$${i++},$${i++},$${i++},$${i++},$${i++},$${i++},$${i++})`
    );
    params.push(
      runId, hostId, sourceHost,
      vm.vm_id, vm.name, vm.state, vm.generation,
      vm.cpu_count, vm.memory_mb, vm.memory_type, vm.disk_gb,
      vm.ips, vm.mac_addresses, vm.os_name, vm.os_type,
      vm.uptime_seconds, vm.is_template,
      vm.snapshot_count, vm.snapshot_oldest || null,
      vm.cluster || null
    );
  }
  await db.query(
    `INSERT INTO hyperv_discovered_vms
       (run_id, host_id, source_host,
        vm_id, name, state, generation,
        cpu_count, memory_mb, memory_type, disk_gb,
        ips, mac_addresses, os_name, os_type,
        uptime_seconds, is_template,
        snapshot_count, snapshot_oldest, cluster)
     VALUES ${values.join(',')}`,
    params
  );
}

async function getLatestVMs(hostId) {
  const params = [];
  let where = '';
  if (hostId) { params.push(hostId); where = 'AND v.host_id = $1'; }
  const { rows } = await db.query(
    `WITH latest_runs AS (
       SELECT DISTINCT ON (host_id) id AS run_id, host_id
       FROM hyperv_discovery_runs
       WHERE status = 'success' ${where}
       ORDER BY host_id, run_at DESC
     )
     SELECT v.*
     FROM hyperv_discovered_vms v
     JOIN latest_runs lr ON lr.run_id = v.run_id AND lr.host_id = v.host_id
     ORDER BY v.source_host, v.name`,
    params
  );
  return rows;
}

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

async function getDashboardStats() {
  const vms = await getLatestVMs();
  const stats = { total: 0, running: 0, stopped: 0, saved: 0, paused: 0, templates: 0, gen1: 0, gen2: 0 };
  const byHost = {};
  const byOS   = {};

  for (const vm of vms) {
    if (vm.is_template) { stats.templates++; continue; }
    stats.total++;
    const st = (vm.state || '').toLowerCase();
    if (st === 'running') stats.running++;
    else if (st === 'off') stats.stopped++;
    else if (st === 'saved') stats.saved++;
    else if (st === 'paused') stats.paused++;
    if (vm.generation === 1) stats.gen1++;
    if (vm.generation === 2) stats.gen2++;

    const h = vm.source_host || 'Unknown';
    if (!byHost[h]) byHost[h] = { host: h, total: 0, running: 0, stopped: 0 };
    byHost[h].total++;
    if (st === 'running') byHost[h].running++;
    if (st === 'off')     byHost[h].stopped++;

    const os = vm.os_type || 'Unknown';
    byOS[os] = (byOS[os] || 0) + 1;
  }

  return {
    stats,
    byHost: Object.values(byHost).sort((a, b) => b.total - a.total),
    byOS:   Object.entries(byOS).sort((a, b) => b[1] - a[1]).map(([os, count]) => ({ os, count })),
  };
}

// ---------------------------------------------------------------------------
// Drift
// ---------------------------------------------------------------------------

async function getDrift() {
  const { rows: runRows } = await db.query(
    `SELECT DISTINCT ON (host_id)
            host_id,
            id     AS current_run_id,
            run_at AS current_at,
            (SELECT id FROM hyperv_discovery_runs r2
             WHERE r2.host_id = r1.host_id AND r2.status = 'success' AND r2.id <> r1.id
             ORDER BY r2.run_at DESC LIMIT 1) AS previous_run_id
     FROM hyperv_discovery_runs r1
     WHERE status = 'success'
     ORDER BY host_id, run_at DESC`
  );

  const results = [];
  for (const run of runRows) {
    if (!run.previous_run_id) continue;
    const [{ rows: curr }, { rows: prev }] = await Promise.all([
      db.query('SELECT * FROM hyperv_discovered_vms WHERE run_id = $1', [run.current_run_id]),
      db.query('SELECT * FROM hyperv_discovered_vms WHERE run_id = $1', [run.previous_run_id]),
    ]);
    const key       = v => v.vm_id || v.name;
    const currByKey = Object.fromEntries(curr.map(v => [key(v), v]));
    const prevByKey = Object.fromEntries(prev.map(v => [key(v), v]));
    const added   = curr.filter(v => !prevByKey[key(v)]);
    const removed = prev.filter(v => !currByKey[key(v)]);
    const changed = curr
      .filter(v => {
        const p = prevByKey[key(v)];
        return p && (v.state !== p.state || JSON.stringify(v.ips) !== JSON.stringify(p.ips));
      })
      .map(v => ({ ...v, prev_state: prevByKey[key(v)].state, prev_ips: prevByKey[key(v)].ips }));

    results.push({
      host: curr[0]?.source_host || String(run.host_id),
      current_at: run.current_at,
      added, removed, changed,
      summary: { added: added.length, removed: removed.length, changed: changed.length },
    });
  }
  return results;
}

// ---------------------------------------------------------------------------
// Stale VMs
// ---------------------------------------------------------------------------

async function getStaleVMs() {
  const vms    = await getLatestVMs();
  const drift  = await getDrift();
  const removed = drift.flatMap(d => d.removed);
  const noNet   = vms.filter(v => !v.is_template && (v.state || '').toLowerCase() === 'running' &&
                                  (!v.ips || v.ips.length === 0));
  const stopped = vms.filter(v => !v.is_template && (v.state || '').toLowerCase() === 'off');
  return { removed, noNetwork: noNet, stopped, total: vms.length };
}

// ---------------------------------------------------------------------------
// Snapshots
// ---------------------------------------------------------------------------

async function getSnapshotVMs() {
  const vms = await getLatestVMs();
  return vms
    .filter(v => v.snapshot_count > 0)
    .map(v => ({
      name:        v.name,
      source_host: v.source_host,
      state:       v.state,
      count:       v.snapshot_count,
      oldest:      v.snapshot_oldest || '—',
    }))
    .sort((a, b) => b.count - a.count);
}

module.exports = {
  listHosts, getHostById, upsertHost, updateHostById, deleteHost,
  setHostRunning, setLastDiscovery, getDecryptedPassword,
  startRun, finishRun, failRun, getRunHistory,
  saveVMs, getLatestVMs,
  getDashboardStats, getDrift, getStaleVMs, getSnapshotVMs,
};
