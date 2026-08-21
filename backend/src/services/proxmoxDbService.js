/**
 * proxmoxDbService.js
 * -------------------
 * All PostgreSQL operations for Proxmox VE / PDM discovery data.
 */

const db     = require('../config/db');
const crypto = require('../utils/crypto');
const wsHub  = require('./wsHub');

// ---------------------------------------------------------------------------
// Hosts
// ---------------------------------------------------------------------------

async function listHosts() {
  const { rows } = await db.query(
    `SELECT id, host, host_type, username, realm, token_id, port, verify_ssl,
            interval_minutes, scheduler_enabled, last_discovery_at, last_vm_count,
            is_running, last_status, last_error, last_attempt_at, created_at, updated_at
     FROM proxmox_hosts ORDER BY host`
  );
  return rows;
}

async function getHostById(id) {
  const { rows } = await db.query('SELECT * FROM proxmox_hosts WHERE id = $1', [id]);
  return rows[0] || null;
}

async function getHostByName(host) {
  const { rows } = await db.query('SELECT * FROM proxmox_hosts WHERE host = $1', [host]);
  return rows[0] || null;
}

async function upsertHost({
  host, hostType = 've', username, realm = 'pam',
  password, tokenId, tokenSecret,
  port, verifySSL, intervalMinutes, schedulerEnabled,
}) {
  const passwordEnc    = password     ? crypto.encrypt(password)     : null;
  const tokenSecretEnc = tokenSecret  ? crypto.encrypt(tokenSecret)  : null;

  const { rows } = await db.query(
    `INSERT INTO proxmox_hosts
       (host, host_type, username, realm, password_encrypted, token_id, token_secret_encrypted,
        port, verify_ssl, interval_minutes, scheduler_enabled)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     ON CONFLICT (host) DO UPDATE SET
       host_type               = EXCLUDED.host_type,
       username                = EXCLUDED.username,
       realm                   = EXCLUDED.realm,
       password_encrypted      = COALESCE(EXCLUDED.password_encrypted, proxmox_hosts.password_encrypted),
       token_id                = EXCLUDED.token_id,
       token_secret_encrypted  = COALESCE(EXCLUDED.token_secret_encrypted, proxmox_hosts.token_secret_encrypted),
       port                    = EXCLUDED.port,
       verify_ssl              = EXCLUDED.verify_ssl,
       interval_minutes        = EXCLUDED.interval_minutes,
       scheduler_enabled       = EXCLUDED.scheduler_enabled,
       updated_at              = NOW()
     RETURNING id, host, host_type, username, realm, token_id, port, verify_ssl,
               interval_minutes, scheduler_enabled, last_discovery_at, last_vm_count, is_running`,
    [
      host, hostType, username, realm,
      passwordEnc, tokenId || null, tokenSecretEnc,
      port || (hostType === 'pdm' ? 8007 : 8006),
      verifySSL !== false,
      intervalMinutes || 60,
      schedulerEnabled || false,
    ]
  );
  return rows[0];
}

async function updateHostById(id, {
  host, hostType = 've', username, realm = 'pam',
  password, tokenId, tokenSecret,
  port, verifySSL, intervalMinutes, schedulerEnabled,
}) {
  const passwordEnc    = password     ? crypto.encrypt(password)     : null;
  const tokenSecretEnc = tokenSecret  ? crypto.encrypt(tokenSecret)  : null;

  const { rows } = await db.query(
    `UPDATE proxmox_hosts SET
       host                    = $2,
       host_type               = $3,
       username                = $4,
       realm                   = $5,
       password_encrypted      = COALESCE($6, password_encrypted),
       token_id                = $7,
       token_secret_encrypted  = COALESCE($8, token_secret_encrypted),
       port                    = $9,
       verify_ssl              = $10,
       interval_minutes        = $11,
       scheduler_enabled       = $12,
       updated_at              = NOW()
     WHERE id = $1
     RETURNING id, host, host_type, username, realm, token_id, port, verify_ssl,
               interval_minutes, scheduler_enabled, last_discovery_at, last_vm_count, is_running`,
    [
      id,
      host, hostType, username, realm,
      passwordEnc, tokenId || null, tokenSecretEnc,
      port || (hostType === 'pdm' ? 8007 : 8006),
      verifySSL !== false,
      intervalMinutes || 60,
      schedulerEnabled || false,
    ]
  );
  return rows[0] || null;
}

async function deleteHost(id) {
  const { rowCount } = await db.query('DELETE FROM proxmox_hosts WHERE id = $1', [id]);
  return rowCount > 0;
}

async function setHostRunning(id, running) {
  await db.query('UPDATE proxmox_hosts SET is_running = $2 WHERE id = $1', [id, running]);
}

async function setLastDiscovery(id, vmCount) {
  await db.query(
    `UPDATE proxmox_hosts
        SET last_discovery_at = NOW(), last_vm_count = $2, is_running = FALSE,
            last_status = 'success', last_error = NULL, last_attempt_at = NOW(),
            discovery_fail_count = 0
      WHERE id = $1`,
    [id, vmCount]
  );
  wsHub.broadcastAlertsChanged();
}

// Returns the new consecutive-failure count, so the caller can tier the
// Teams alert (1st = Warning, 2nd+ = Critical).
async function setLastDiscoveryFailed(id, errorMessage) {
  const { rows } = await db.query(
    `UPDATE proxmox_hosts
        SET is_running = FALSE, last_status = 'error', last_error = $2, last_attempt_at = NOW(),
            discovery_fail_count = discovery_fail_count + 1
      WHERE id = $1
      RETURNING discovery_fail_count`,
    [id, errorMessage]
  );
  wsHub.broadcastAlertsChanged();
  return rows[0]?.discovery_fail_count || 1;
}

function getDecryptedPassword(host) {
  return host.password_encrypted ? crypto.decrypt(host.password_encrypted) : null;
}

function getDecryptedTokenSecret(host) {
  return host.token_secret_encrypted ? crypto.decrypt(host.token_secret_encrypted) : null;
}

// ---------------------------------------------------------------------------
// Discovery runs
// ---------------------------------------------------------------------------

async function startRun(hostId, sourceHost) {
  const { rows } = await db.query(
    `INSERT INTO proxmox_discovery_runs (host_id, source_host, status)
     VALUES ($1, $2, 'running') RETURNING id`,
    [hostId, sourceHost]
  );
  return rows[0].id;
}

async function finishRun(runId, vmCount) {
  await db.query(
    `UPDATE proxmox_discovery_runs SET status = 'success', vm_count = $2 WHERE id = $1`,
    [runId, vmCount]
  );
}

async function failRun(runId, errorMessage) {
  await db.query(
    `UPDATE proxmox_discovery_runs SET status = 'error', error_message = $2 WHERE id = $1`,
    [runId, errorMessage]
  );
}

async function getRunHistory(hostId, limit = 20) {
  const params = [limit];
  let where = '';
  if (hostId) { params.unshift(hostId); where = 'WHERE r.host_id = $1'; }
  const { rows } = await db.query(
    `SELECT r.id, r.source_host, r.vm_count, r.status, r.error_message, r.run_at,
            h.host, h.host_type
     FROM proxmox_discovery_runs r
     JOIN proxmox_hosts h ON h.id = r.host_id
     ${where}
     ORDER BY r.run_at DESC
     LIMIT $${params.length}`,
    params
  );
  return rows;
}

// ---------------------------------------------------------------------------
// VM / container records
// ---------------------------------------------------------------------------

async function saveVMs(runId, hostId, sourceHost, vms) {
  if (!vms.length) return;
  const values = [];
  const params = [];
  let i = 1;
  for (const vm of vms) {
    values.push(
      `($${i++},$${i++},$${i++},$${i++},$${i++},$${i++},$${i++},$${i++},$${i++},$${i++},$${i++},$${i++},$${i++},$${i++},$${i++},$${i++},$${i++},$${i++},$${i++},$${i++},$${i++},$${i++})`
    );
    params.push(
      runId, hostId, sourceHost,
      vm.vmid, vm.name, vm.hostname, vm.vm_type, vm.node,
      vm.status, vm.cpu_count, vm.memory_mb, vm.disk_gb,
      vm.ips, vm.macs, vm.os_type, vm.uptime_seconds, vm.is_template,
      vm.snapshot_count, vm.snapshot_oldest,
      vm.tags, vm.pool, vm.cluster
    );
  }
  await db.query(
    `INSERT INTO proxmox_discovered_vms
       (run_id, host_id, source_host,
        vmid, name, hostname, vm_type, node,
        status, cpu_count, memory_mb, disk_gb,
        ips, macs, os_type, uptime_seconds, is_template,
        snapshot_count, snapshot_oldest,
        tags, pool, cluster)
     VALUES ${values.join(',')}`,
    params
  );
}

async function getLatestVMs(hostId) {
  const params = [];
  let where = '';
  // Inside the CTE this filters proxmox_discovery_runs directly (no "v"
  // alias in scope there — that belongs to the outer query), matching the
  // same fix applied to getLatestNodes above.
  if (hostId) { params.push(hostId); where = 'AND host_id = $1'; }
  const { rows } = await db.query(
    `WITH latest_runs AS (
       SELECT DISTINCT ON (host_id) id AS run_id, host_id
       FROM proxmox_discovery_runs
       WHERE status = 'success' ${where}
       ORDER BY host_id, run_at DESC
     )
     SELECT v.*
     FROM proxmox_discovered_vms v
     JOIN latest_runs lr ON lr.run_id = v.run_id AND lr.host_id = v.host_id
     ORDER BY v.source_host, v.node, v.name`,
    params
  );
  return rows;
}

// ---------------------------------------------------------------------------
// Cluster node records (physical/virtual Proxmox hosts, not guests)
// ---------------------------------------------------------------------------

async function saveNodes(runId, hostId, sourceHost, nodes) {
  if (!nodes || !nodes.length) return;
  const values = [];
  const params = [];
  let i = 1;
  for (const n of nodes) {
    values.push(
      `($${i++},$${i++},$${i++},$${i++},$${i++},$${i++},$${i++},$${i++},$${i++},$${i++},$${i++},$${i++},$${i++},$${i++},$${i++},$${i++},$${i++},$${i++},$${i++},$${i++})`
    );
    params.push(
      runId, hostId, sourceHost,
      n.node, n.status, n.ip_address, n.mac_address,
      n.os_type, n.os_version, n.cpu_model, n.cpu_cores, n.cpu_sockets, n.cpu_usage_pct,
      n.memory_mb, n.memory_used_mb, n.disk_total_gb, n.disk_used_gb,
      n.uptime_seconds, n.vm_count, n.snapshot_count
    );
  }
  await db.query(
    `INSERT INTO proxmox_discovered_nodes
       (run_id, host_id, source_host,
        node, status, ip_address, mac_address,
        os_type, os_version, cpu_model, cpu_cores, cpu_sockets, cpu_usage_pct,
        memory_mb, memory_used_mb, disk_total_gb, disk_used_gb,
        uptime_seconds, vm_count, snapshot_count)
     VALUES ${values.join(',')}`,
    params
  );
}

async function getLatestNodes(hostId) {
  const params = [];
  let where = '';
  // Inside the CTE this filters proxmox_discovery_runs directly (no "v"
  // alias in scope there — that belongs to the outer query).
  if (hostId) { params.push(hostId); where = 'AND host_id = $1'; }
  const { rows } = await db.query(
    `WITH latest_runs AS (
       SELECT DISTINCT ON (host_id) id AS run_id, host_id
       FROM proxmox_discovery_runs
       WHERE status = 'success' ${where}
       ORDER BY host_id, run_at DESC
     )
     SELECT v.*
     FROM proxmox_discovered_nodes v
     JOIN latest_runs lr ON lr.run_id = v.run_id AND lr.host_id = v.host_id
     ORDER BY v.source_host, v.node`,
    params
  );
  return rows;
}

// ---------------------------------------------------------------------------
// Dashboard stats
// ---------------------------------------------------------------------------

async function getDashboardStats() {
  const vms = await getLatestVMs();
  const stats = { total: 0, running: 0, stopped: 0, paused: 0, qemu: 0, lxc: 0, templates: 0 };
  const byNode = {};
  const byHost = {};
  const byOS   = {};

  for (const vm of vms) {
    if (vm.is_template) { stats.templates++; continue; }
    stats.total++;
    if (vm.status === 'running') stats.running++;
    else if (vm.status === 'stopped') stats.stopped++;
    else if (vm.status === 'paused') stats.paused++;
    if (vm.vm_type === 'qemu') stats.qemu++;
    if (vm.vm_type === 'lxc')  stats.lxc++;

    const nodeKey = `${vm.source_host}||${vm.node}`;
    if (!byNode[nodeKey]) {
      byNode[nodeKey] = { host: vm.source_host, node: vm.node, total: 0, running: 0, stopped: 0, qemu: 0, lxc: 0 };
    }
    byNode[nodeKey].total++;
    if (vm.status === 'running') byNode[nodeKey].running++;
    if (vm.status === 'stopped') byNode[nodeKey].stopped++;
    if (vm.vm_type === 'qemu')   byNode[nodeKey].qemu++;
    if (vm.vm_type === 'lxc')    byNode[nodeKey].lxc++;

    const h = vm.source_host || 'Unknown';
    if (!byHost[h]) byHost[h] = { host: h, total: 0, running: 0, qemu: 0, lxc: 0 };
    byHost[h].total++;
    if (vm.status === 'running') byHost[h].running++;
    if (vm.vm_type === 'qemu')   byHost[h].qemu++;
    if (vm.vm_type === 'lxc')    byHost[h].lxc++;

    const os = vm.os_type || 'Unknown';
    byOS[os] = (byOS[os] || 0) + 1;
  }

  return {
    stats,
    byNode: Object.values(byNode).sort((a, b) => b.total - a.total),
    byHost: Object.values(byHost).sort((a, b) => b.total - a.total),
    byOS:   Object.entries(byOS).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([os, count]) => ({ os, count })),
  };
}

// ---------------------------------------------------------------------------
// Drift detection — compare latest two successful runs per host
// ---------------------------------------------------------------------------

async function getDrift() {
  const { rows: runRows } = await db.query(
    `SELECT DISTINCT ON (host_id)
            host_id,
            id       AS current_run_id,
            run_at   AS current_at,
            (SELECT id FROM proxmox_discovery_runs r2
             WHERE r2.host_id = r1.host_id AND r2.status = 'success' AND r2.id <> r1.id
             ORDER BY r2.run_at DESC LIMIT 1) AS previous_run_id
     FROM proxmox_discovery_runs r1
     WHERE status = 'success'
     ORDER BY host_id, run_at DESC`
  );

  const diffable = runRows.filter(r => r.previous_run_id);
  if (!diffable.length) return [];

  // One query for every VM row needed across all hosts, instead of two
  // per host in a loop — avoids an N+1 query pattern that scaled linearly
  // with host count.
  const runIds = [...new Set(diffable.flatMap(r => [r.current_run_id, r.previous_run_id]))];
  const { rows: allVms } = await db.query(
    'SELECT * FROM proxmox_discovered_vms WHERE run_id = ANY($1::int[])', [runIds]
  );
  const vmsByRun = new Map();
  for (const vm of allVms) {
    if (!vmsByRun.has(vm.run_id)) vmsByRun.set(vm.run_id, []);
    vmsByRun.get(vm.run_id).push(vm);
  }

  const results = [];
  for (const run of diffable) {
    const curr = vmsByRun.get(run.current_run_id)  || [];
    const prev = vmsByRun.get(run.previous_run_id) || [];

    const key       = v => `${v.node}/${v.vmid}`;
    const currByKey = Object.fromEntries(curr.map(v => [key(v), v]));
    const prevByKey = Object.fromEntries(prev.map(v => [key(v), v]));

    const added   = curr.filter(v => !prevByKey[key(v)]);
    const removed = prev.filter(v => !currByKey[key(v)]);
    const changed = curr
      .filter(v => {
        const p = prevByKey[key(v)];
        return p && (v.status !== p.status || JSON.stringify(v.ips) !== JSON.stringify(p.ips));
      })
      .map(v => ({
        ...v,
        prev_status: prevByKey[key(v)].status,
        prev_ips:    prevByKey[key(v)].ips,
      }));

    results.push({
      host:       curr[0]?.source_host || String(run.host_id),
      current_at: run.current_at,
      added, removed, changed,
      summary: { added: added.length, removed: removed.length, changed: changed.length },
    });
  }
  return results;
}

// Full VM-level added/removed/changed detail for every consecutive pair of
// successful runs per host within the last `days` days — not just the
// latest pair, like getDrift. Mirrors vmwareDbService's getDriftActivity.
async function getDriftActivity(days = 7) {
  const { rows: runRows } = await db.query(
    `SELECT host_id, id AS run_id, run_at
       FROM proxmox_discovery_runs
      WHERE status = 'success' AND run_at >= NOW() - INTERVAL '1 day' * ($1 + 1)
      ORDER BY host_id, run_at ASC`,
    [days]
  );
  if (!runRows.length) return [];

  // Cap runs considered per host — each run stores a full VM snapshot (not
  // a delta), so a host polled far more often than the default interval
  // could otherwise balloon the fetch below into hundreds of thousands of
  // rows and exhaust memory. Runs are already ordered oldest-first, so
  // slicing keeps the most recent ones.
  const MAX_RUNS_PER_HOST = 200;
  const runsByHost = new Map();
  for (const r of runRows) {
    if (!runsByHost.has(r.host_id)) runsByHost.set(r.host_id, []);
    runsByHost.get(r.host_id).push(r);
  }
  for (const [hostId, runs] of runsByHost) {
    if (runs.length > MAX_RUNS_PER_HOST) runsByHost.set(hostId, runs.slice(-MAX_RUNS_PER_HOST));
  }

  const runIds = [...runsByHost.values()].flat().map(r => r.run_id);
  const { rows: allVms } = await db.query(
    'SELECT * FROM proxmox_discovered_vms WHERE run_id = ANY($1::int[])', [runIds]
  );
  const vmsByRun = new Map();
  for (const vm of allVms) {
    if (!vmsByRun.has(vm.run_id)) vmsByRun.set(vm.run_id, []);
    vmsByRun.get(vm.run_id).push(vm);
  }

  const key = v => `${v.node}/${v.vmid}`;
  const cutoff = new Date(Date.now() - days * 86400000);
  const results = [];

  for (const runs of runsByHost.values()) {
    for (let i = 1; i < runs.length; i++) {
      const prev = runs[i - 1];
      const curr = runs[i];
      if (new Date(curr.run_at) < cutoff) continue;

      const currVms = vmsByRun.get(curr.run_id) || [];
      const prevVms = vmsByRun.get(prev.run_id) || [];
      const currByKey = Object.fromEntries(currVms.map(v => [key(v), v]));
      const prevByKey = Object.fromEntries(prevVms.map(v => [key(v), v]));

      const added   = currVms.filter(v => !prevByKey[key(v)]);
      const removed = prevVms.filter(v => !currByKey[key(v)]);
      const changed = currVms.filter(v => {
        const p = prevByKey[key(v)];
        return p && (v.status !== p.status || JSON.stringify(v.ips) !== JSON.stringify(p.ips));
      }).map(v => ({
        ...v,
        prev_status: prevByKey[key(v)].status,
        prev_ips:    prevByKey[key(v)].ips,
      }));

      if (!added.length && !removed.length && !changed.length) continue;

      results.push({
        host:       currVms[0]?.source_host || prevVms[0]?.source_host || String(curr.host_id),
        current_at: curr.run_at,
        added, removed, changed,
        summary: { added: added.length, removed: removed.length, changed: changed.length },
      });
    }
  }

  results.sort((a, b) => new Date(b.current_at) - new Date(a.current_at));
  return results;
}

// Day-by-day added/removed/changed counts across all hosts for the last
// `days` days, zero-filled for days with no runs. Mirrors vmwareDbService's
// getDriftHistory.
async function getDriftHistory(days = 7) {
  const { rows: runRows } = await db.query(
    `SELECT host_id, id AS run_id, run_at
       FROM proxmox_discovery_runs
      WHERE status = 'success' AND run_at >= NOW() - INTERVAL '1 day' * ($1 + 1)
      ORDER BY host_id, run_at ASC`,
    [days]
  );

  const vmsByRun = new Map();
  if (runRows.length) {
    const runIds = runRows.map(r => r.run_id);
    const { rows: vmRows } = await db.query(
      'SELECT run_id, node, vmid, status, ips FROM proxmox_discovered_vms WHERE run_id = ANY($1::int[])',
      [runIds]
    );
    for (const v of vmRows) {
      if (!vmsByRun.has(v.run_id)) vmsByRun.set(v.run_id, new Map());
      vmsByRun.get(v.run_id).set(`${v.node}/${v.vmid}`, v);
    }
  }

  const runsByHost = new Map();
  for (const r of runRows) {
    if (!runsByHost.has(r.host_id)) runsByHost.set(r.host_id, []);
    runsByHost.get(r.host_id).push(r);
  }

  const cutoff = new Date(Date.now() - days * 86400000);
  const dailyMap = new Map();

  for (const runs of runsByHost.values()) {
    for (let i = 1; i < runs.length; i++) {
      const prev = runs[i - 1];
      const curr = runs[i];
      if (new Date(curr.run_at) < cutoff) continue;

      const prevVms = vmsByRun.get(prev.run_id) || new Map();
      const currVms = vmsByRun.get(curr.run_id) || new Map();

      let added = 0, removed = 0, changed = 0;
      for (const [key, vm] of currVms) {
        const p = prevVms.get(key);
        if (!p) { added++; continue; }
        if (vm.status !== p.status || JSON.stringify(vm.ips) !== JSON.stringify(p.ips)) changed++;
      }
      for (const key of prevVms.keys()) {
        if (!currVms.has(key)) removed++;
      }

      const dateKey = new Date(curr.run_at).toISOString().slice(0, 10);
      const bucket = dailyMap.get(dateKey) || { added: 0, removed: 0, changed: 0 };
      bucket.added += added;
      bucket.removed += removed;
      bucket.changed += changed;
      dailyMap.set(dateKey, bucket);
    }
  }

  const result = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400000);
    const dateKey = d.toISOString().slice(0, 10);
    const bucket = dailyMap.get(dateKey) || { added: 0, removed: 0, changed: 0 };
    result.push({ date: dateKey, ...bucket });
  }
  return result;
}

// ---------------------------------------------------------------------------
// Node topology
// ---------------------------------------------------------------------------

async function getNodeTopology() {
  const vms = await getLatestVMs();
  const topology = {};

  for (const vm of vms) {
    if (vm.is_template) continue;
    const source = vm.source_host || 'Unknown';
    const node   = vm.node        || 'Unknown';
    if (!topology[source])       topology[source] = {};
    if (!topology[source][node]) {
      topology[source][node] = { node, source, total: 0, running: 0, stopped: 0, qemu: 0, lxc: 0 };
    }
    const s = topology[source][node];
    s.total++;
    if (vm.status === 'running') s.running++;
    if (vm.status === 'stopped') s.stopped++;
    if (vm.vm_type === 'qemu')   s.qemu++;
    if (vm.vm_type === 'lxc')    s.lxc++;
  }

  return Object.entries(topology)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([host, nodeMap]) => ({
      host,
      nodes: Object.values(nodeMap).sort((a, b) => a.node.localeCompare(b.node)),
    }));
}

// ---------------------------------------------------------------------------
// Stale VMs
// ---------------------------------------------------------------------------

async function getStaleVMs() {
  const vms      = await getLatestVMs();
  const drift    = await getDrift();
  const removed  = drift.flatMap(d => d.removed);
  const noNet    = vms.filter(v => !v.is_template && v.status === 'running' &&
                                   (!v.ips || (v.ips.length === 1 && v.ips[0] === 'Not Available')));
  const stopped  = vms.filter(v => !v.is_template && v.status === 'stopped');
  return { removed, noNetwork: noNet, stopped, total: vms.length };
}

// ---------------------------------------------------------------------------
// Snapshot report
// ---------------------------------------------------------------------------

async function getSnapshotVMs() {
  const vms = await getLatestVMs();
  return vms
    .filter(v => v.snapshot_count > 0)
    .map(v => ({
      vmid:        v.vmid,
      name:        v.name,
      vm_type:     v.vm_type,
      source_host: v.source_host,
      node:        v.node,
      status:      v.status,
      count:       v.snapshot_count,
      oldest:      v.snapshot_oldest || '—',
    }))
    .sort((a, b) => b.count - a.count);
}

module.exports = {
  listHosts, getHostById, getHostByName, upsertHost, updateHostById, deleteHost,
  setHostRunning, setLastDiscovery, setLastDiscoveryFailed, getDecryptedPassword, getDecryptedTokenSecret,
  startRun, finishRun, failRun, getRunHistory,
  saveVMs, getLatestVMs,
  saveNodes, getLatestNodes,
  getDashboardStats, getDrift, getDriftActivity, getDriftHistory, getNodeTopology, getStaleVMs, getSnapshotVMs,
};
