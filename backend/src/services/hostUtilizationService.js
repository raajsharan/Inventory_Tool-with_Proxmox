/**
 * hostUtilizationService.js
 * --------------------------
 * CPU/Memory "High Utilization" monitor — config (admin-set thresholds),
 * a live snapshot of hosts currently over threshold (joined against
 * Physical & ESXi Servers for Assigned User / Department), and a logged
 * history of every discovery tick that crossed either threshold. The log
 * is written by checkAndLog*() calls placed right after each platform's
 * scheduler saves fresh telemetry (vmwareSchedulerService.js /
 * proxmoxSchedulerService.js / hypervSchedulerService.js), the same way
 * pingMonitorService.js's config/check logic is combined in one file.
 */
const db       = require('../config/db');
const vmwareDb = require('./vmwareDbService');
const proxmoxDb = require('./proxmoxDbService');
const hypervDb = require('./hypervDbService');

const DEFAULTS = { enabled: true, cpu_threshold_pct: 85, memory_threshold_pct: 85 };

async function getConfig() {
  const { rows } = await db.query('SELECT * FROM utilization_monitor_config LIMIT 1');
  return rows[0] ? rows[0] : { ...DEFAULTS, id: null };
}

function validPct(n) {
  return Number.isFinite(n) && n >= 0 && n <= 100;
}

async function saveConfig(fields) {
  const cfg = await getConfig();
  const {
    enabled              = cfg.enabled,
    cpu_threshold_pct    = cfg.cpu_threshold_pct,
    memory_threshold_pct = cfg.memory_threshold_pct,
  } = fields;

  const cpuPct = Number(cpu_threshold_pct);
  const memPct = Number(memory_threshold_pct);
  if (!validPct(cpuPct)) throw new Error(`Invalid CPU threshold "${cpu_threshold_pct}" — expected a number 0-100`);
  if (!validPct(memPct)) throw new Error(`Invalid memory threshold "${memory_threshold_pct}" — expected a number 0-100`);

  await db.query(
    `INSERT INTO utilization_monitor_config (enabled, cpu_threshold_pct, memory_threshold_pct, updated_at)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (singleton) DO UPDATE SET
        enabled              = EXCLUDED.enabled,
        cpu_threshold_pct    = EXCLUDED.cpu_threshold_pct,
        memory_threshold_pct = EXCLUDED.memory_threshold_pct,
        updated_at           = NOW()`,
    [enabled === true || enabled === 'true', cpuPct, memPct],
  );
  return getConfig();
}

function memPctOf(usedMb, totalMb) {
  const used  = Number(usedMb);
  const total = Number(totalMb);
  if (!total || !Number.isFinite(used) || !Number.isFinite(total)) return null;
  return Math.round((used / total) * 1000) / 10;
}

async function logIfOver({ platform, hostId, host, ipAddress, cpuPct, memoryPct }) {
  const cfg = await getConfig();
  if (cfg.enabled === false) return;
  const cpuOver = cpuPct    != null && cpuPct    >= (cfg.cpu_threshold_pct    ?? DEFAULTS.cpu_threshold_pct);
  const memOver = memoryPct != null && memoryPct >= (cfg.memory_threshold_pct ?? DEFAULTS.memory_threshold_pct);
  if (!cpuOver && !memOver) return;

  await db.query(
    `INSERT INTO host_utilization_alerts
       (platform, host_id, host, ip_address, cpu_pct, memory_pct, cpu_over, memory_over)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [platform, hostId, host, ipAddress || null, cpuPct, memoryPct, cpuOver, memOver],
  );
}

// allStats: entries from vmwareService.getAllHostStats — { esxi_name, esxi_ip,
// cpu_usage_pct, memory_total_mb, memory_used_mb, ... }. Covers both the
// standalone-ESXi (allStats.length === 1) and vCenter (many) cases uniformly.
async function checkAndLogVMware(hostId, allStats) {
  for (const s of allStats || []) {
    await logIfOver({
      platform: 'VMware',
      hostId,
      host: s.esxi_name || s.esxi_ip,
      ipAddress: s.esxi_ip,
      cpuPct: s.cpu_usage_pct ?? null,
      memoryPct: memPctOf(s.memory_used_mb, s.memory_total_mb),
    }).catch(err => console.error(`[utilization-monitor] failed to log VMware alert for ${s.esxi_name || s.esxi_ip}:`, err.message));
  }
}

// nodes: entries from proxmoxService.discover()'s `nodes` array — { node,
// ip_address, cpu_usage_pct, memory_mb (total), memory_used_mb, ... }.
async function checkAndLogProxmox(hostId, nodes) {
  for (const n of nodes || []) {
    await logIfOver({
      platform: 'Proxmox',
      hostId,
      host: n.node,
      ipAddress: n.ip_address,
      cpuPct: n.cpu_usage_pct ?? null,
      memoryPct: memPctOf(n.memory_used_mb, n.memory_mb),
    }).catch(err => console.error(`[utilization-monitor] failed to log Proxmox alert for ${n.node}:`, err.message));
  }
}

// stats: single object from hypervService.getHostStats() — { cpu_usage_pct,
// memory_total_mb, memory_used_mb }. One physical host per Hyper-V connection.
async function checkAndLogHyperV(hostId, hostAddress, stats) {
  if (!stats) return;
  await logIfOver({
    platform: 'Hyper-V',
    hostId,
    host: hostAddress,
    ipAddress: hostAddress,
    cpuPct: stats.cpu_usage_pct ?? null,
    memoryPct: memPctOf(stats.memory_used_mb, stats.memory_total_mb),
  }).catch(err => console.error(`[utilization-monitor] failed to log Hyper-V alert for ${hostAddress}:`, err.message));
}

// Attaches Assigned User / Department from Physical & ESXi Servers by IP,
// for whichever candidate rows are already over threshold. Unmatched hosts
// keep null fields — the frontend renders those as "—".
async function attachOwnership(candidates) {
  const ips = [...new Set(candidates.map(c => c.ip_address).filter(Boolean))];
  if (!ips.length) return candidates.map(c => ({ ...c, assigned_user: null, department: null }));

  const { rows } = await db.query(
    `SELECT DISTINCT ON (ip_address) ip_address, assigned_user, department
       FROM physical_esxi_servers
      WHERE ip_address = ANY($1::text[])
        AND deleted_at IS NULL AND decommissioned_at IS NULL`,
    [ips],
  );
  const byIp = new Map(rows.map(r => [r.ip_address, r]));
  return candidates.map(c => {
    const match = c.ip_address && byIp.get(c.ip_address);
    return { ...c, assigned_user: match?.assigned_user ?? null, department: match?.department ?? null };
  });
}

async function getCurrentHighUtilization() {
  const cfg = await getConfig();
  const cpuThreshold = cfg.cpu_threshold_pct ?? DEFAULTS.cpu_threshold_pct;
  const memThreshold = cfg.memory_threshold_pct ?? DEFAULTS.memory_threshold_pct;

  const [vmwareHosts, vmwareEsxiMap, proxmoxNodes, hypervHosts] = await Promise.all([
    vmwareDb.listHosts(),
    vmwareDb.getEsxiHostStatsMap(),
    proxmoxDb.getLatestNodes(),
    hypervDb.listHosts(),
  ]);

  const candidates = [];

  // Standalone ESXi connections carry their own stats directly; vCenter
  // connections have theirs cleared to NULL (see vmwareSchedulerService.js),
  // so this never double-counts a vCenter's children.
  for (const h of vmwareHosts) {
    if (h.cpu_usage_pct == null && h.memory_used_mb == null) continue;
    candidates.push({
      platform: 'VMware', host: h.host, ip_address: h.host,
      cpu_pct: h.cpu_usage_pct ?? null, memory_pct: memPctOf(h.memory_used_mb, h.memory_total_mb),
    });
  }
  for (const s of vmwareEsxiMap.values()) {
    candidates.push({
      platform: 'VMware', host: s.esxi_name || s.esxi_ip, ip_address: s.esxi_ip,
      cpu_pct: s.cpu_usage_pct ?? null, memory_pct: memPctOf(s.memory_used_mb, s.memory_total_mb),
    });
  }
  for (const n of proxmoxNodes) {
    candidates.push({
      platform: 'Proxmox', host: n.node, ip_address: n.ip_address,
      cpu_pct: n.cpu_usage_pct ?? null, memory_pct: memPctOf(n.memory_used_mb, n.memory_mb),
    });
  }
  for (const h of hypervHosts) {
    if (h.cpu_usage_pct == null && h.memory_used_mb == null) continue;
    candidates.push({
      platform: 'Hyper-V', host: h.host, ip_address: h.host,
      cpu_pct: h.cpu_usage_pct ?? null, memory_pct: memPctOf(h.memory_used_mb, h.memory_total_mb),
    });
  }

  const over = candidates.filter(c =>
    (c.cpu_pct != null && c.cpu_pct >= cpuThreshold) || (c.memory_pct != null && c.memory_pct >= memThreshold)
  );
  return attachOwnership(over);
}

// days = 0 means all-time.
async function summary({ days = 30 } = {}) {
  const n = parseInt(days, 10);
  const sinceClause = n > 0 ? `WHERE created_at >= NOW() - INTERVAL '${n} days'` : '';

  const [byDate, byPlatform, totalRow] = await Promise.all([
    db.query(
      `SELECT DATE(created_at) AS date, COUNT(*)::int AS count
         FROM host_utilization_alerts ${sinceClause}
        GROUP BY DATE(created_at) ORDER BY DATE(created_at)`,
    ),
    db.query(
      `SELECT platform, COUNT(*)::int AS count
         FROM host_utilization_alerts ${sinceClause}
        GROUP BY platform ORDER BY platform`,
    ),
    db.query(`SELECT COUNT(*)::int AS total FROM host_utilization_alerts ${sinceClause}`),
  ]);

  return {
    byDate: byDate.rows.map(r => ({ date: r.date, count: r.count })),
    byPlatform: byPlatform.rows.map(r => ({ platform: r.platform, count: r.count })),
    total: totalRow.rows[0]?.total ?? 0,
  };
}

module.exports = {
  getConfig, saveConfig,
  checkAndLogVMware, checkAndLogProxmox, checkAndLogHyperV,
  getCurrentHighUtilization, summary,
};
