/**
 * vmwareDbService.js
 * ------------------
 * All PostgreSQL operations for VMware discovery data.
 */

const db       = require('../config/db');
const crypto   = require('../utils/crypto');
const wsHub    = require('./wsHub');

// ---------------------------------------------------------------------------
// Hosts (credentials)
// ---------------------------------------------------------------------------

async function listHosts() {
  const { rows } = await db.query(
    `SELECT id, host, username, port, verify_ssl, interval_minutes,
            scheduler_enabled, last_discovery_at, last_vm_count, is_running,
            last_status, last_error, last_attempt_at,
            hardware_model, cpu_cores, cpu_usage_pct,
            memory_total_mb, memory_used_mb, disk_total_gb, disk_used_gb, uptime_seconds,
            created_at, updated_at
     FROM vmware_hosts ORDER BY host`
  );
  return rows;
}

async function getHostById(id) {
  const { rows } = await db.query(
    `SELECT * FROM vmware_hosts WHERE id = $1`, [id]
  );
  return rows[0] || null;
}

async function getHostByName(host) {
  const { rows } = await db.query(
    `SELECT * FROM vmware_hosts WHERE host = $1`, [host]
  );
  return rows[0] || null;
}

async function upsertHost({ host, username, password, port, verifySSL, intervalMinutes, schedulerEnabled }) {
  const encrypted = crypto.encrypt(password);
  const { rows } = await db.query(
    `INSERT INTO vmware_hosts
       (host, username, password_encrypted, port, verify_ssl, interval_minutes, scheduler_enabled)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (host) DO UPDATE SET
       username           = EXCLUDED.username,
       password_encrypted = CASE WHEN EXCLUDED.password_encrypted IS NOT NULL
                                 THEN EXCLUDED.password_encrypted
                                 ELSE vmware_hosts.password_encrypted END,
       port               = EXCLUDED.port,
       verify_ssl         = EXCLUDED.verify_ssl,
       interval_minutes   = EXCLUDED.interval_minutes,
       scheduler_enabled  = EXCLUDED.scheduler_enabled,
       updated_at         = NOW()
     RETURNING id, host, username, port, verify_ssl, interval_minutes,
               scheduler_enabled, last_discovery_at, last_vm_count, is_running`,
    [host, username, encrypted, port, verifySSL, intervalMinutes, schedulerEnabled]
  );
  return rows[0];
}

async function deleteHost(id) {
  const { rowCount } = await db.query(`DELETE FROM vmware_hosts WHERE id = $1`, [id]);
  return rowCount > 0;
}

async function setHostRunning(id, running) {
  await db.query(`UPDATE vmware_hosts SET is_running = $2 WHERE id = $1`, [id, running]);
}

async function setLastDiscovery(id, vmCount) {
  await db.query(
    `UPDATE vmware_hosts
        SET last_discovery_at = NOW(), last_vm_count = $2, is_running = FALSE,
            last_status = 'success', last_error = NULL, last_attempt_at = NOW()
      WHERE id = $1`,
    [id, vmCount]
  );
  // A recovery clears this host's alert-bell entry — tell connected clients
  // to refetch, same as on a failure.
  wsHub.broadcastAlertsChanged();
}

async function setLastDiscoveryFailed(id, errorMessage) {
  await db.query(
    `UPDATE vmware_hosts
        SET is_running = FALSE, last_status = 'error', last_error = $2, last_attempt_at = NOW()
      WHERE id = $1`,
    [id, errorMessage]
  );
  wsHub.broadcastAlertsChanged();
}

// Best-effort hardware telemetry — called alongside a successful discovery
// run, never blocking it on failure. Only meaningful for a standalone-ESXi
// row (exactly one ESXi host); a vCenter row managing several hosts with
// different hardware has nothing single to report here (see
// setEsxiHostStats for the per-host breakdown instead).
async function setHostStats(id, stats) {
  if (!stats) return;
  await db.query(
    `UPDATE vmware_hosts
        SET hardware_model  = $2, cpu_cores = $3, cpu_usage_pct = $4,
            memory_total_mb = $5, memory_used_mb = $6,
            disk_total_gb   = $7, disk_used_gb = $8, uptime_seconds = $9
      WHERE id = $1`,
    [
      id, stats.hardware_model, stats.cpu_cores, stats.cpu_usage_pct,
      stats.memory_total_mb, stats.memory_used_mb,
      stats.disk_total_gb, stats.disk_used_gb, stats.uptime_seconds,
    ]
  );
}

async function clearHostStats(id) {
  await db.query(
    `UPDATE vmware_hosts
        SET hardware_model = NULL, cpu_cores = NULL, cpu_usage_pct = NULL,
            memory_total_mb = NULL, memory_used_mb = NULL,
            disk_total_gb = NULL, disk_used_gb = NULL, uptime_seconds = NULL
      WHERE id = $1`,
    [id]
  );
}

// Per-ESXi-host hardware breakdown, for a vCenter (or standalone-ESXi) row's
// expandable table. Replaces the full set each run — a host removed from
// vCenter (or renamed) shouldn't linger here indefinitely.
async function setEsxiHostStats(hostId, statsList) {
  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM vmware_esxi_host_stats WHERE host_id = $1', [hostId]);
    for (const s of statsList || []) {
      await client.query(
        `INSERT INTO vmware_esxi_host_stats
           (host_id, esxi_name, esxi_ip, hardware_model, cpu_cores, cpu_usage_pct,
            memory_total_mb, memory_used_mb, disk_total_gb, disk_used_gb, uptime_seconds)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [
          hostId, s.esxi_name, s.esxi_ip, s.hardware_model, s.cpu_cores, s.cpu_usage_pct,
          s.memory_total_mb, s.memory_used_mb, s.disk_total_gb, s.disk_used_gb, s.uptime_seconds,
        ]
      );
    }
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

// Keyed by "name|ip" to match how getESXiTopology() keys its own map.
async function getEsxiHostStatsMap() {
  const { rows } = await db.query(
    `SELECT esxi_name, esxi_ip, hardware_model, cpu_cores, cpu_usage_pct,
            memory_total_mb, memory_used_mb, disk_total_gb, disk_used_gb, uptime_seconds
       FROM vmware_esxi_host_stats`
  );
  const map = new Map();
  for (const r of rows) map.set(`${r.esxi_name}|${r.esxi_ip}`, r);
  return map;
}

function getDecryptedPassword(host) {
  return crypto.decrypt(host.password_encrypted);
}

// ---------------------------------------------------------------------------
// Discovery runs
// ---------------------------------------------------------------------------

async function startRun(hostId, sourceHost) {
  const { rows } = await db.query(
    `INSERT INTO vmware_discovery_runs (host_id, source_host, status)
     VALUES ($1, $2, 'running') RETURNING id`,
    [hostId, sourceHost]
  );
  return rows[0].id;
}

async function finishRun(runId, vmCount) {
  await db.query(
    `UPDATE vmware_discovery_runs SET status = 'success', vm_count = $2 WHERE id = $1`,
    [runId, vmCount]
  );
}

async function failRun(runId, errorMessage) {
  await db.query(
    `UPDATE vmware_discovery_runs SET status = 'error', error_message = $2 WHERE id = $1`,
    [runId, errorMessage]
  );
}

async function getRunHistory(hostId, limit = 20) {
  const params = [limit];
  let where = '';
  if (hostId) { params.unshift(hostId); where = 'WHERE r.host_id = $1'; }
  const { rows } = await db.query(
    `SELECT r.id, r.source_host, r.vm_count, r.status, r.error_message, r.run_at,
            h.host
     FROM vmware_discovery_runs r
     JOIN vmware_hosts h ON h.id = r.host_id
     ${where}
     ORDER BY r.run_at DESC
     LIMIT $${params.length}`,
    params
  );
  return rows;
}

// ---------------------------------------------------------------------------
// VM records
// ---------------------------------------------------------------------------

async function saveVMs(runId, hostId, sourceHost, vms) {
  if (!vms.length) return;
  // Bulk insert using a single multi-value query
  const values = [];
  const params = [];
  let i = 1;
  for (const vm of vms) {
    values.push(
      `($${i++},$${i++},$${i++},$${i++},$${i++},$${i++},$${i++},$${i++},$${i++},$${i++},$${i++},$${i++},$${i++},$${i++},$${i++},$${i++},$${i++},$${i++},$${i++},$${i++},$${i++})`
    );
    params.push(
      runId, hostId, sourceHost,
      vm.name, vm.hostname,
      vm.ips, vm.esxi_host_name, vm.esxi_host_ip,
      vm.os_type, vm.os_version,
      vm.macs, vm.created_date, vm.power_state, vm.tools_status,
      vm.num_cpu, vm.memory_mb,
      vm.storage_committed_gb, vm.storage_uncommitted_gb,
      vm.datastores,
      vm.snapshot_count, vm.snapshot_oldest
    );
  }
  await db.query(
    `INSERT INTO vmware_discovered_vms
       (run_id, host_id, source_host,
        name, hostname,
        ips, esxi_host_name, esxi_host_ip,
        os_type, os_version,
        macs, created_date, power_state, tools_status,
        num_cpu, memory_mb,
        storage_committed_gb, storage_uncommitted_gb,
        datastores,
        snapshot_count, snapshot_oldest)
     VALUES ${values.join(',')}`,
    params
  );
}

// Return VMs from the latest successful run per host
async function getLatestVMs(hostId) {
  let where = '';
  const params = [];
  if (hostId) { params.push(hostId); where = 'AND v.host_id = $1'; }

  const { rows } = await db.query(
    `WITH latest_runs AS (
       SELECT DISTINCT ON (host_id)
              id AS run_id, host_id
       FROM vmware_discovery_runs
       WHERE status = 'success'
       ${where}
       ORDER BY host_id, run_at DESC
     )
     SELECT v.*
     FROM vmware_discovered_vms v
     JOIN latest_runs lr ON lr.run_id = v.run_id AND lr.host_id = v.host_id
     ORDER BY v.source_host, v.name`,
    params
  );
  return rows;
}

// ---------------------------------------------------------------------------
// Dashboard stats
// ---------------------------------------------------------------------------

async function getDashboardStats() {
  const vms = await getLatestVMs();
  const stats = { total: 0, poweredOn: 0, poweredOff: 0, suspended: 0 };
  const byHost  = {};
  const byOS    = {};

  for (const vm of vms) {
    stats.total++;
    if (vm.power_state === 'poweredOn')  stats.poweredOn++;
    else if (vm.power_state === 'poweredOff') stats.poweredOff++;
    else if (vm.power_state === 'suspended')  stats.suspended++;

    const h = vm.source_host || 'Unknown';
    if (!byHost[h]) byHost[h] = { host: h, total: 0, poweredOn: 0, poweredOff: 0 };
    byHost[h].total++;
    if (vm.power_state === 'poweredOn')  byHost[h].poweredOn++;
    if (vm.power_state === 'poweredOff') byHost[h].poweredOff++;

    const os = (vm.os_type && vm.os_type !== 'Not Available') ? vm.os_type : 'Unknown';
    byOS[os] = (byOS[os] || 0) + 1;
  }

  return {
    stats,
    byHost:  Object.values(byHost).sort((a, b) => b.total - a.total),
    byOS:    Object.entries(byOS).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([os, count]) => ({ os, count })),
    total:   vms.length,
  };
}

// ---------------------------------------------------------------------------
// Drift detection — compare latest two runs per host
// ---------------------------------------------------------------------------

async function getDrift() {
  // Get latest 2 run IDs per host
  const { rows: runRows } = await db.query(
    `SELECT DISTINCT ON (host_id)
            host_id,
            id       AS current_run_id,
            run_at   AS current_at,
            (
              SELECT id FROM vmware_discovery_runs r2
              WHERE r2.host_id = r1.host_id AND r2.status = 'success' AND r2.id <> r1.id
              ORDER BY r2.run_at DESC LIMIT 1
            ) AS previous_run_id
     FROM vmware_discovery_runs r1
     WHERE status = 'success'
     ORDER BY host_id, run_at DESC`
  );

  const diffable = runRows.filter(r => r.previous_run_id);  // need at least 2 runs to diff
  if (!diffable.length) return [];

  // One query for every VM row needed across all hosts, instead of two
  // per host in a loop — avoids an N+1 query pattern that scaled linearly
  // with host count.
  const runIds = [...new Set(diffable.flatMap(r => [r.current_run_id, r.previous_run_id]))];
  const { rows: allVms } = await db.query(
    `SELECT * FROM vmware_discovered_vms WHERE run_id = ANY($1::int[])`, [runIds]
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

    const currByName = Object.fromEntries(curr.map(v => [v.name, v]));
    const prevByName = Object.fromEntries(prev.map(v => [v.name, v]));

    const added   = curr.filter(v => !prevByName[v.name]);
    const removed = prev.filter(v => !currByName[v.name]);
    const changed = curr.filter((v) => {
      const p = prevByName[v.name];
      if (!p) return false;
      return (
        v.power_state !== p.power_state ||
        JSON.stringify(v.ips) !== JSON.stringify(p.ips)
      );
    }).map((v) => ({
      ...v,
      prev_power_state: prevByName[v.name].power_state,
      prev_ips:         prevByName[v.name].ips,
    }));

    results.push({
      host:          curr[0]?.source_host || run.host_id,
      current_at:    run.current_at,
      added, removed, changed,
      summary: { added: added.length, removed: removed.length, changed: changed.length },
    });
  }
  return results;
}

// ---------------------------------------------------------------------------
// ESXi topology
// ---------------------------------------------------------------------------

async function getESXiTopology() {
  const [vms, statsMap] = await Promise.all([getLatestVMs(), getEsxiHostStatsMap()]);
  const topology = {};  // vcenter → { esxiKey → stats }

  for (const vm of vms) {
    const vcenter = vm.source_host || 'Unknown';
    if (!topology[vcenter]) topology[vcenter] = {};

    const esxiName = vm.esxi_host_name || 'Not Available';
    const esxiIp   = vm.esxi_host_ip   || 'Not Available';
    const key      = `${esxiName}|${esxiIp}`;

    if (!topology[vcenter][key]) {
      const hw = statsMap.get(key);
      topology[vcenter][key] = {
        esxi_name: esxiName, esxi_ip: esxiIp, vcenter,
        vm_count: 0, powered_on: 0, powered_off: 0, suspended: 0,
        hardware_model:  hw?.hardware_model  ?? null,
        cpu_cores:       hw?.cpu_cores       ?? null,
        cpu_usage_pct:   hw?.cpu_usage_pct   ?? null,
        memory_total_mb: hw?.memory_total_mb ?? null,
        memory_used_mb:  hw?.memory_used_mb  ?? null,
        disk_total_gb:   hw?.disk_total_gb   ?? null,
        disk_used_gb:    hw?.disk_used_gb    ?? null,
        uptime_seconds:  hw?.uptime_seconds  ?? null,
      };
    }
    const s = topology[vcenter][key];
    s.vm_count++;
    if (vm.power_state === 'poweredOn')  s.powered_on++;
    if (vm.power_state === 'poweredOff') s.powered_off++;
    if (vm.power_state === 'suspended')  s.suspended++;
  }

  return Object.entries(topology).sort(([a], [b]) => a.localeCompare(b)).map(([vcenter, esxiMap]) => ({
    vcenter,
    esxi_hosts: Object.values(esxiMap).sort((a, b) => a.esxi_name.localeCompare(b.esxi_name)),
  }));
}

// ---------------------------------------------------------------------------
// Stale VMs
// ---------------------------------------------------------------------------

async function getStaleVMs() {
  const vms = await getLatestVMs();
  const driftData = await getDrift();

  const removedVMs = driftData.flatMap(d => d.removed);
  const noNetwork  = vms.filter(v => v.power_state === 'poweredOn' && (!v.ips || v.ips.join('') === 'Not Available'));
  const poweredOff = vms.filter(v => v.power_state === 'poweredOff');

  return { removed: removedVMs, noNetwork, poweredOff, total: vms.length };
}

// ---------------------------------------------------------------------------
// Snapshot report
// ---------------------------------------------------------------------------

async function getSnapshotVMs() {
  const vms = await getLatestVMs();
  return vms
    .filter(v => v.snapshot_count > 0)
    .map(v => ({
      name:          v.name,
      source_host:   v.source_host,
      esxi_host:     v.esxi_host_name,
      power_state:   v.power_state,
      count:         v.snapshot_count,
      oldest:        v.snapshot_oldest || '—',
    }))
    .sort((a, b) => b.count - a.count);
}

// ---------------------------------------------------------------------------
// Reconciliation — discovered VMs vs the inventory, matched by IP and MAC.
// ---------------------------------------------------------------------------

const normMac = (m) => String(m || '').toLowerCase().replace(/[^0-9a-f]/g, '');
const validIp = (ip) => ip && ip !== 'Not Available' && !String(ip).startsWith('fe80');

async function getReconciliation() {
  const [discovered, inv] = await Promise.all([
    getLatestVMs(),
    db.query(`
      SELECT id, vm_name, ip_address::text AS ip_address, mac_address, os_type, 'assets' AS source
        FROM assets WHERE deleted_at IS NULL AND decommissioned_at IS NULL
      UNION ALL
      SELECT id, vm_name, ip_address::text, mac_address, os_type, 'beijing_assets'
        FROM beijing_assets WHERE deleted_at IS NULL AND decommissioned_at IS NULL
      UNION ALL
      SELECT id, vm_name, ip_address::text, mac_address, os_type, 'ext_assets'
        FROM ext_assets WHERE deleted_at IS NULL AND decommissioned_at IS NULL
      UNION ALL
      SELECT id, vm_name, ip_address::text, mac_address, os_type, 'physical_esxi_servers'
        FROM physical_esxi_servers WHERE deleted_at IS NULL AND decommissioned_at IS NULL
    `).then(r => r.rows),
  ]);

  // Index the inventory by IP and by MAC.
  const invByIp = new Map();
  const invByMac = new Map();
  for (const a of inv) {
    if (validIp(a.ip_address)) invByIp.set(a.ip_address.trim(), a);
    const mac = normMac(a.mac_address);
    if (mac.length === 12) invByMac.set(mac, a);
  }

  const matchedInvIds = new Set();
  const not_in_inventory = [];
  for (const vm of discovered) {
    const ips  = (vm.ips  || []).filter(validIp).map(s => s.trim());
    const macs = (vm.macs || []).map(normMac).filter(m => m.length === 12);
    let match = null;
    let matched_by = null;
    for (const ip of ips)   { if (invByIp.has(ip))    { match = invByIp.get(ip);   matched_by = 'ip';  break; } }
    if (!match) for (const m of macs) { if (invByMac.has(m)) { match = invByMac.get(m); matched_by = 'mac'; break; } }
    if (match) {
      matchedInvIds.add(`${match.source}:${match.id}`);
    } else {
      not_in_inventory.push({
        id: vm.id, name: vm.name, hostname: vm.hostname,
        ips, macs: vm.macs || [], os_type: vm.os_type,
        power_state: vm.power_state, esxi_host_name: vm.esxi_host_name,
        source_host: vm.source_host,
      });
    }
    void matched_by;
  }

  // Inventory records never seen by discovery (matched neither IP nor MAC).
  const discoveredIps  = new Set(discovered.flatMap(v => (v.ips  || []).filter(validIp).map(s => s.trim())));
  const discoveredMacs = new Set(discovered.flatMap(v => (v.macs || []).map(normMac).filter(m => m.length === 12)));
  const not_discovered = inv.filter(a => {
    if (matchedInvIds.has(`${a.source}:${a.id}`)) return false;
    if (validIp(a.ip_address) && discoveredIps.has(a.ip_address.trim())) return false;
    const mac = normMac(a.mac_address);
    if (mac.length === 12 && discoveredMacs.has(mac)) return false;
    return true;
  });

  return {
    discovered_total: discovered.length,
    inventory_total:  inv.length,
    matched:          discovered.length - not_in_inventory.length,
    not_in_inventory,
    not_discovered:   not_discovered.slice(0, 500),
    not_discovered_total: not_discovered.length,
  };
}

module.exports = {
  listHosts, getHostById, getHostByName, upsertHost, deleteHost,
  setHostRunning, setLastDiscovery, setLastDiscoveryFailed, getDecryptedPassword,
  setHostStats, clearHostStats, setEsxiHostStats,
  startRun, finishRun, failRun, getRunHistory,
  saveVMs, getLatestVMs, getReconciliation,
  getDashboardStats, getDrift, getESXiTopology, getStaleVMs, getSnapshotVMs,
};
