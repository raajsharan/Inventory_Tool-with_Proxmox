/**
 * esxiUtilizationService.js
 * --------------------------
 * Per-ESXi-host CPU / RAM / storage utilization for the "ESXi Utilization"
 * page. Everything comes from data the app already collects:
 *   - vmware_esxi_host_stats  (cpu cores + usage %, memory, datastore totals,
 *                              written by each VMware discovery run)
 *   - latest discovered VMs   (VM count per ESXi host)
 *   - physical_esxi_servers   (Department / Location, matched by IP)
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

// Warning starts 15 points below the critical threshold (70% at the 85% default).
const WARN_GAP = 15;

async function getOwnership(ips) {
  if (!ips.length) return new Map();
  const { rows } = await db.query(
    `SELECT DISTINCT ON (ip_address) ip_address, vm_name, department, location
       FROM physical_esxi_servers
      WHERE ip_address = ANY($1::text[])
        AND deleted_at IS NULL AND decommissioned_at IS NULL
      ORDER BY ip_address, updated_at DESC`,
    [ips],
  );
  return new Map(rows.map(r => [r.ip_address, r]));
}

async function getCapacity() {
  const [topology, cfg, stamp] = await Promise.all([
    vmwareDb.getESXiTopology(),
    utilization.getConfig(),
    db.query('SELECT MAX(updated_at) AS at FROM vmware_esxi_host_stats'),
  ]);

  const flat = topology.flatMap(v => v.esxi_hosts.map(h => ({ ...h, vcenter: v.vcenter })))
    // VMs whose host could not be resolved are grouped under 'Not Available' — not a real host.
    .filter(h => h.esxi_name !== 'Not Available' || h.esxi_ip !== 'Not Available');
  const owners = await getOwnership([...new Set(flat.map(h => h.esxi_ip).filter(Boolean))]);

  const hosts = flat.map((h) => {
    const o = owners.get(h.esxi_ip);
    const cores = h.cpu_cores == null ? null : Number(h.cpu_cores);
    const ramGb = h.memory_total_mb == null ? null : Math.round((Number(h.memory_total_mb) / 1024) * 10) / 10;
    const ramUsedGb = h.memory_used_mb == null ? null : Math.round((Number(h.memory_used_mb) / 1024) * 10) / 10;
    const diskTotal = num(h.disk_total_gb);
    const diskUsed = num(h.disk_used_gb);
    const cpuPct = num(h.cpu_usage_pct);
    return {
      name: h.esxi_name, ip: h.esxi_ip, vcenter: h.vcenter,
      department: (o?.department || '').trim() || 'Unassigned',
      location: (o?.location || '').trim() || 'Unassigned',
      assetName: o?.vm_name || null,
      vms: h.vm_count, poweredOn: h.powered_on,
      cpuCores: cores, cpuPct,
      ramGb, ramUsedGb, ramPct: pct(h.memory_used_mb, h.memory_total_mb),
      storageTb: diskTotal == null ? null : Math.round((diskTotal / 1024) * 100) / 100,
      storageUsedTb: diskUsed == null ? null : Math.round((diskUsed / 1024) * 100) / 100,
      storagePct: pct(diskUsed, diskTotal),
      hasStats: cores != null && cpuPct != null && ramGb != null,
    };
  });

  const crit = {
    cpu: cfg.cpu_threshold_pct ?? 85,
    ram: cfg.memory_threshold_pct ?? 85,
    storage: cfg.disk_threshold_pct ?? 85,
  };
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
    lastDiscoveryAt: stamp.rows[0]?.at || null,
  };
}

module.exports = { getCapacity };
