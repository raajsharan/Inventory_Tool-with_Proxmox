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

// days = 0 means all-time (no lower bound on created_at).
async function summary({ days = 30 } = {}) {
  const n = parseInt(days, 10);
  const since = n > 0 ? `created_at >= NOW() - INTERVAL '${n} days'` : null;
  const where = (extra) => {
    const conds = [since, extra].filter(Boolean);
    return conds.length ? `WHERE ${conds.join(' AND ')}` : '';
  };

  const [byDate, byPlatform, totalRow, timedOutTotalRow, timedOutByPlatform] = await Promise.all([
    db.query(
      `SELECT DATE(created_at) AS date, COUNT(*)::int AS count
         FROM host_connectivity_alerts
         ${where()}
        GROUP BY DATE(created_at)
        ORDER BY DATE(created_at)`,
    ),
    db.query(
      `SELECT platform, COUNT(*)::int AS count
         FROM host_connectivity_alerts
         ${where()}
        GROUP BY platform
        ORDER BY platform`,
    ),
    db.query(`SELECT COUNT(*)::int AS total FROM host_connectivity_alerts ${where()}`),
    db.query(`SELECT COUNT(*)::int AS total FROM host_connectivity_alerts ${where('timed_out')}`),
    db.query(
      `SELECT platform, COUNT(*)::int AS count
         FROM host_connectivity_alerts
         ${where('timed_out')}
        GROUP BY platform
        ORDER BY platform`,
    ),
  ]);

  return {
    byDate: byDate.rows.map(r => ({ date: r.date, count: r.count })),
    byPlatform: byPlatform.rows.map(r => ({ platform: r.platform, count: r.count })),
    total: totalRow.rows[0]?.total ?? 0,
    timedOut: {
      total: timedOutTotalRow.rows[0]?.total ?? 0,
      byPlatform: timedOutByPlatform.rows.map(r => ({ platform: r.platform, count: r.count })),
    },
  };
}

module.exports = { summary, logDiscoveryFailure };
