/**
 * hostAlertsService.js
 * ---------------------
 * Read side of the ping-monitor's alert history (host_connectivity_alerts,
 * written by pingMonitorService.js) — powers the Connectivity Alerts page's
 * "by date" / "by platform" cards.
 */
const db = require('../config/db');

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

module.exports = { summary };
