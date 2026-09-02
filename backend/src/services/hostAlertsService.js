/**
 * hostAlertsService.js
 * ---------------------
 * host_connectivity_alerts — written by two independent sources (the
 * ping-monitor's own ICMP/SSH dual check in pingMonitorService.js, and
 * logDiscoveryFailure() below, called from each platform's scheduler when a
 * discovery run itself can't reach the host's management API) and read here
 * to power the Connectivity Alerts page's "by date" / "by platform" cards.
 */
const db = require('../config/db');
const { AUTH_PATTERN } = require('./alertsService');
const pingMonitorService = require('./pingMonitorService');

// Platform -> its configured check interval field in ping_monitor_config,
// used to turn a ping-monitor alert's bare fail_count into a "checked every
// N min, down for ~N*fail_count min" detail on the alert list.
const INTERVAL_FIELD = { VMware: 'vmware_interval_minutes', Proxmox: 'proxmox_interval_minutes', 'Hyper-V': 'hyperv_interval_minutes' };

// Logs a discovery-run connection failure as a connectivity alert — but only
// when it actually IS one. A bad password/expired token is a credential
// problem, not "this host is unreachable", so those are deliberately
// excluded here (they still show up in the separate Discovery Alerts bell).
async function logDiscoveryFailure({ platform, hostId, host, errorMessage, failCount }) {
  const msg = errorMessage || '';
  if (AUTH_PATTERN.test(msg)) return;

  const timedOut = /timed out/i.test(msg);
  const severity = (failCount || 1) === 1 ? 'warning' : 'critical';
  await db.query(
    `INSERT INTO host_connectivity_alerts
       (platform, host_id, host, severity, ping_ok, ssh_ok, fail_count, timed_out, source)
     VALUES ($1, $2, $3, $4, FALSE, NULL, $5, $6, 'discovery')`,
    [platform, hostId, host, severity, failCount || 1, timedOut],
  );
}

const PLATFORMS = ['VMware', 'Proxmox', 'Hyper-V'];

// A zero-filled (no missing days) daily count series between two "days ago"
// offsets, inclusive — e.g. (6, 0) is the last 7 days including today. Both
// the generated date spine and the count subquery key off CURRENT_DATE so
// they can never disagree by a day, unlike mixing DATE(created_at) against a
// NOW() - INTERVAL timestamp bound would risk. Needed (rather than a plain
// GROUP BY) because the dashboard's sparklines and period-over-period chart
// zip two series together positionally — a day with zero alerts has to still
// occupy a slot, or everything after it would line up against the wrong day.
function zeroFillBetween(startOffsetDays, endOffsetDays, extraWhere) {
  const extra = extraWhere ? `AND ${extraWhere}` : '';
  return db.query(
    `SELECT gs.d::date AS date, COALESCE(c.count, 0)::int AS count
       FROM generate_series((CURRENT_DATE - ${startOffsetDays}::int), (CURRENT_DATE - ${endOffsetDays}::int), INTERVAL '1 day') AS gs(d)
       LEFT JOIN (
         SELECT DATE(created_at) AS date, COUNT(*)::int AS count
           FROM host_connectivity_alerts
          WHERE DATE(created_at) BETWEEN (CURRENT_DATE - ${startOffsetDays}::int) AND (CURRENT_DATE - ${endOffsetDays}::int)
          ${extra}
          GROUP BY DATE(created_at)
       ) c ON c.date = gs.d::date
      ORDER BY gs.d`,
  );
}

function newPlatformBucket() {
  return { total: 0, previousTotal: null, pingFailed: 0, discoveryUnreachable: 0, byDate: [] };
}

// days = 0 means all-time — there's no well-defined "previous period" for an
// unbounded range, so previousTotal/previousByDate come back null/empty and
// the frontend skips the period-over-period comparison for that case.
async function summary({ days = 30 } = {}) {
  const n = parseInt(days, 10);
  const hasWindow = n > 0;
  const platforms = {};
  for (const p of PLATFORMS) platforms[p] = newPlatformBucket();

  if (!hasWindow) {
    const [byDateRes, bySourceRes, byDatePlatformRes, discoveryByDateRes] = await Promise.all([
      db.query(`SELECT DATE(created_at) AS date, COUNT(*)::int AS count FROM host_connectivity_alerts GROUP BY DATE(created_at) ORDER BY DATE(created_at)`),
      db.query(`SELECT platform, source, COUNT(*)::int AS count FROM host_connectivity_alerts GROUP BY platform, source`),
      db.query(`SELECT platform, DATE(created_at) AS date, COUNT(*)::int AS count FROM host_connectivity_alerts GROUP BY platform, DATE(created_at) ORDER BY platform, DATE(created_at)`),
      db.query(`SELECT DATE(created_at) AS date, COUNT(*)::int AS count FROM host_connectivity_alerts WHERE source = 'discovery' GROUP BY DATE(created_at) ORDER BY DATE(created_at)`),
    ]);
    for (const r of bySourceRes.rows) {
      const b = platforms[r.platform]; if (!b) continue;
      b.total += r.count;
      if (r.source === 'discovery') b.discoveryUnreachable += r.count; else b.pingFailed += r.count;
    }
    for (const r of byDatePlatformRes.rows) {
      const b = platforms[r.platform]; if (b) b.byDate.push({ date: r.date, count: r.count });
    }
    return {
      total: byDateRes.rows.reduce((s, r) => s + r.count, 0),
      byDate: byDateRes.rows.map(r => ({ date: r.date, count: r.count })),
      previousByDate: [],
      hasPreviousPeriod: false,
      platforms,
      discovery: {
        total: PLATFORMS.reduce((s, p) => s + platforms[p].discoveryUnreachable, 0),
        previousTotal: null,
        byDate: discoveryByDateRes.rows.map(r => ({ date: r.date, count: r.count })),
      },
    };
  }

  const [
    curAgg, prevAgg, curVMware, curProxmox, curHyperV, curDiscovery,
    bySourceRes, prevBySourceRes,
  ] = await Promise.all([
    zeroFillBetween(n - 1, 0),
    zeroFillBetween(2 * n - 1, n),
    zeroFillBetween(n - 1, 0, `platform = 'VMware'`),
    zeroFillBetween(n - 1, 0, `platform = 'Proxmox'`),
    zeroFillBetween(n - 1, 0, `platform = 'Hyper-V'`),
    zeroFillBetween(n - 1, 0, `source = 'discovery'`),
    db.query(`SELECT platform, source, COUNT(*)::int AS count FROM host_connectivity_alerts WHERE created_at >= NOW() - INTERVAL '${n} days' GROUP BY platform, source`),
    db.query(`SELECT platform, source, COUNT(*)::int AS count FROM host_connectivity_alerts WHERE created_at >= NOW() - INTERVAL '${2 * n} days' AND created_at < NOW() - INTERVAL '${n} days' GROUP BY platform, source`),
  ]);

  for (const r of bySourceRes.rows) {
    const b = platforms[r.platform]; if (!b) continue;
    b.total += r.count;
    if (r.source === 'discovery') b.discoveryUnreachable += r.count; else b.pingFailed += r.count;
  }
  for (const p of PLATFORMS) platforms[p].previousTotal = 0;
  for (const r of prevBySourceRes.rows) {
    const b = platforms[r.platform]; if (b) b.previousTotal += r.count;
  }
  platforms.VMware.byDate     = curVMware.rows.map(r => ({ date: r.date, count: r.count }));
  platforms.Proxmox.byDate    = curProxmox.rows.map(r => ({ date: r.date, count: r.count }));
  platforms['Hyper-V'].byDate = curHyperV.rows.map(r => ({ date: r.date, count: r.count }));

  return {
    total: curAgg.rows.reduce((s, r) => s + r.count, 0),
    byDate: curAgg.rows.map(r => ({ date: r.date, count: r.count })),
    previousByDate: prevAgg.rows.map(r => ({ date: r.date, count: r.count })),
    hasPreviousPeriod: true,
    platforms,
    discovery: {
      total: PLATFORMS.reduce((s, p) => s + platforms[p].discoveryUnreachable, 0),
      previousTotal: prevBySourceRes.rows.filter(r => r.source === 'discovery').reduce((s, r) => s + r.count, 0),
      byDate: curDiscovery.rows.map(r => ({ date: r.date, count: r.count })),
    },
  };
}

// Paginated, most-recent-first raw alert rows — backs the Connectivity
// Alerts page's detail table (host, alert type, timing) underneath the
// aggregate cards. `intervals` is each platform's currently configured
// ping-monitor check interval, so the frontend can render "checked every N
// min, ~N*fail_count min down" for ping_monitor-sourced rows without a
// second round trip.
async function list({ days = 30, page = 1, pageSize = 50 } = {}) {
  const n = parseInt(days, 10);
  const since = n > 0 ? `WHERE created_at >= NOW() - INTERVAL '${n} days'` : '';
  const p = Math.max(1, parseInt(page, 10) || 1);
  const size = Math.min(200, Math.max(1, parseInt(pageSize, 10) || 50));
  const offset = (p - 1) * size;

  const [rowsRes, totalRes, cfg] = await Promise.all([
    db.query(
      `SELECT platform, host_id, host, severity, ping_ok, ssh_ok, fail_count, timed_out, source, created_at
         FROM host_connectivity_alerts
         ${since}
        ORDER BY created_at DESC
        LIMIT $1 OFFSET $2`,
      [size, offset],
    ),
    db.query(`SELECT COUNT(*)::int AS total FROM host_connectivity_alerts ${since}`),
    pingMonitorService.getConfig(),
  ]);

  const intervals = {};
  for (const [platform, field] of Object.entries(INTERVAL_FIELD)) {
    intervals[platform] = cfg[field] ?? 5;
  }

  return { rows: rowsRes.rows, total: totalRes.rows[0]?.total ?? 0, intervals };
}

module.exports = { summary, logDiscoveryFailure, list };
