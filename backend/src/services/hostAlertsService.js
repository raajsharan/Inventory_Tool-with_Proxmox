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
  const sinceClause = n > 0 ? `WHERE created_at >= NOW() - INTERVAL '${n} days'` : '';

  const [byDate, byPlatform, totalRow] = await Promise.all([
    db.query(
      `SELECT DATE(created_at) AS date, COUNT(*)::int AS count
         FROM host_connectivity_alerts
         ${sinceClause}
        GROUP BY DATE(created_at)
        ORDER BY DATE(created_at)`,
    ),
    db.query(
      `SELECT platform, COUNT(*)::int AS count
         FROM host_connectivity_alerts
         ${sinceClause}
        GROUP BY platform
        ORDER BY platform`,
    ),
    db.query(`SELECT COUNT(*)::int AS total FROM host_connectivity_alerts ${sinceClause}`),
  ]);

  return {
    byDate: byDate.rows.map(r => ({ date: r.date, count: r.count })),
    byPlatform: byPlatform.rows.map(r => ({ platform: r.platform, count: r.count })),
    total: totalRow.rows[0]?.total ?? 0,
  };
}

module.exports = { summary };
