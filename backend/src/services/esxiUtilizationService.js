/**
 * esxiUtilizationService.js
 * --------------------------
 * Per-ESXi-host CPU / RAM / storage utilization for the "ESXi Utilization"
 * page. The numbers are the same ones shown under
 * VMware Discovery -> Hosts & Credentials:
 *   - a standalone ESXi connection carries its own stats on the vmware_hosts row;
 *   - a vCenter connection's managed hosts are in vmware_esxi_host_stats
 *     (the expandable row of that tab).
 * Each host is then mapped to Physical & ESXi Servers (by IP, falling back to
 * hostname) for Department, Location and Owner (Assigned User). VM counts come
 * from the latest discovered VMs.
 *
 * Warning / critical levels follow the admin thresholds under
 * Administration -> Utilization monitor, so a red bar here means the same
 * thing as an entry on the Connectivity Alerts utilization list.
 */
const db = require('../config/db');
const vmwareDb = require('./vmwareDbService');
const utilization = require('./hostUtilizationService');

const num = (v) => (v == null ? null : Number(v));
const pct = (used, total) => {
  const u = num(used); const t = num(total);
  return t && Number.isFinite(u) && Number.isFinite(t) ? Math.round((u / t) * 1000) / 10 : null;
};
const clean = (v) => String(v ?? '').trim();
const norm = (v) => clean(v).toLowerCase();
// Short hostname so "esx01.corp.local" also matches an inventory entry "esx01".
const shortName = (v) => norm(v).split('.')[0];

// Warning starts 15 points below the critical threshold (70% at the 85% default).
const WARN_GAP = 15;

async function getEsxiStatRows() {
  const { rows } = await db.query(
    `SELECT s.esxi_name, s.esxi_ip, s.hardware_model, s.cpu_cores, s.cpu_usage_pct,
            s.memory_total_mb, s.memory_used_mb, s.disk_total_gb, s.disk_used_gb,
            s.updated_at, h.host AS vcenter
       FROM vmware_esxi_host_stats s
       LEFT JOIN vmware_hosts h ON h.id = s.host_id`,
  );
  return rows;
}

// Physical & ESXi Servers, indexed for IP and hostname lookup.
async function getInventoryIndex() {
  const { rows } = await db.query(
    `SELECT vm_name, os_hostname, ip_address, hosted_ip, department, location, assigned_user, asset_tag
       FROM physical_esxi_servers
      WHERE deleted_at IS NULL AND decommissioned_at IS NULL
      ORDER BY updated_at DESC`,
  );
  const byIp = new Map();
  const byName = new Map();
  for (const r of rows) {
    for (const ip of [r.ip_address, r.hosted_ip]) if (ip && !byIp.has(clean(ip))) byIp.set(clean(ip), r);
    for (const n of [r.vm_name, r.os_hostname]) {
      const k = shortName(n);
      if (k && !byName.has(k)) byName.set(k, r);
    }
  }
  return { byIp, byName };
}

function vmCounts(vms) {
  const byIp = new Map(); const byName = new Map(); const bySource = new Map();
  const bump = (m, k, vm) => {
    if (!k) return;
    const c = m.get(k) || { total: 0, on: 0 };
    c.total++; if (vm.power_state === 'poweredOn') c.on++;
    m.set(k, c);
  };
  for (const vm of vms) {
    bump(byIp, clean(vm.esxi_host_ip), vm);
    bump(byName, norm(vm.esxi_host_name), vm);
    bump(bySource, norm(vm.source_host), vm);
  }
  return { byIp, byName, bySource };
}

async function getCapacity() {
  const [connections, statRows, vms, inv, cfg, stamp] = await Promise.all([
    vmwareDb.listHosts(),
    getEsxiStatRows(),
    vmwareDb.getLatestVMs(),
    getInventoryIndex(),
    utilization.getConfig(),
    db.query('SELECT MAX(updated_at) AS at FROM vmware_esxi_host_stats'),
  ]);
  const counts = vmCounts(vms);

  // 1) Hosts exactly as Hosts & Credentials lists them.
  const raw = [];
  const seenIps = new Set();
  for (const c of connections) {
    // vCenter rows have their stats cleared; only standalone ESXi connections carry their own.
    if (c.cpu_usage_pct == null && c.memory_used_mb == null && c.disk_used_gb == null) continue;
    seenIps.add(clean(c.host));
    raw.push({
      name: c.host, ip: c.host, vcenter: null, model: c.hardware_model, cpuCores: c.cpu_cores,
      cpuPct: c.cpu_usage_pct, memTotalMb: c.memory_total_mb, memUsedMb: c.memory_used_mb,
      diskTotalGb: c.disk_total_gb, diskUsedGb: c.disk_used_gb, vmKey: { source: c.host },
    });
  }
  for (const s of statRows) {
    if (s.esxi_ip && seenIps.has(clean(s.esxi_ip))) continue;
    raw.push({
      name: s.esxi_name || s.esxi_ip, ip: s.esxi_ip, vcenter: s.vcenter, model: s.hardware_model,
      cpuCores: s.cpu_cores, cpuPct: s.cpu_usage_pct, memTotalMb: s.memory_total_mb, memUsedMb: s.memory_used_mb,
      diskTotalGb: s.disk_total_gb, diskUsedGb: s.disk_used_gb, vmKey: { ip: s.esxi_ip, name: s.esxi_name },
    });
  }

  // 2) Numbers, VM counts and Physical & ESXi mapping.
  const hosts = raw.map((h) => {
    const o = (h.ip && inv.byIp.get(clean(h.ip))) || inv.byName.get(shortName(h.name)) || null;
    const vc = (h.vmKey.ip && counts.byIp.get(clean(h.vmKey.ip)))
      || (h.vmKey.name && counts.byName.get(norm(h.vmKey.name)))
      || (h.vmKey.source && counts.bySource.get(norm(h.vmKey.source)))
      || { total: 0, on: 0 };
    const cores = h.cpuCores == null ? null : Number(h.cpuCores);
    const cpuPct = num(h.cpuPct);
    const ramGb = h.memTotalMb == null ? null : Math.round((Number(h.memTotalMb) / 1024) * 10) / 10;
    const ramUsedGb = h.memUsedMb == null ? null : Math.round((Number(h.memUsedMb) / 1024) * 10) / 10;
    const diskTotal = num(h.diskTotalGb);
    const diskUsed = num(h.diskUsedGb);
    return {
      name: h.name, ip: h.ip, vcenter: h.vcenter, model: h.model || null,
      mapped: !!o,
      department: clean(o?.department) || 'Unassigned',
      location: clean(o?.location) || 'Unassigned',
      owner: clean(o?.assigned_user) || null,
      assetName: o?.vm_name || null, assetTag: o?.asset_tag || null,
      vms: vc.total, poweredOn: vc.on,
      cpuCores: cores, cpuPct,
      ramGb, ramUsedGb, ramPct: pct(h.memUsedMb, h.memTotalMb),
      storageTb: diskTotal == null ? null : Math.round((diskTotal / 1024) * 100) / 100,
      storageUsedTb: diskUsed == null ? null : Math.round((diskUsed / 1024) * 100) / 100,
      storagePct: pct(diskUsed, diskTotal),
      hasStats: cores != null && cpuPct != null && ramGb != null,
    };
  }).sort((a, b) => String(a.name).localeCompare(String(b.name)));

  const crit = {
    cpu: cfg.cpu_threshold_pct ?? 85,
    ram: cfg.memory_threshold_pct ?? 85,
    storage: cfg.disk_threshold_pct ?? 85,
  };
  const lastConn = connections.reduce((m, c) => (c.last_discovery_at && (!m || c.last_discovery_at > m) ? c.last_discovery_at : m), null);
  return {
    hosts,
    thresholds: {
      critical: crit,
      warning: {
        cpu: Math.max(0, crit.cpu - WARN_GAP),
        ram: Math.max(0, crit.ram - WARN_GAP),
        storage: Math.max(0, crit.storage - WARN_GAP),
      },
    },
    lastDiscoveryAt: lastConn || stamp.rows[0]?.at || null,
  };
}

module.exports = { getCapacity };
