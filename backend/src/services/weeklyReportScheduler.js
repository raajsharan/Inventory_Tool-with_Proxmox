/**
 * weeklyReportScheduler.js
 * --------------------------
 * Fixed weekly schedule (no per-user config, unlike ping-monitor) — every
 * Wednesday 08:00 server local time, matching how every other scheduler in
 * this codebase runs (no TZ option is set anywhere).
 */
let cron;
try { cron = require('node-cron'); } catch { cron = null; }

const weeklyReportService = require('./weeklyReportService');

const CRON_EXPR = '0 8 * * 3'; // minute=0 hour=8 * * Wednesday(3)

let task = null;

async function start() {
  if (!cron) {
    // eslint-disable-next-line no-console
    console.warn('[weekly-report-scheduler] node-cron not installed — automatic Weekly Report snapshots disabled');
    return;
  }
  if (task) { try { task.stop(); } catch { /* ignore */ } task = null; }
  if (!cron.validate(CRON_EXPR)) {
    // eslint-disable-next-line no-console
    console.warn(`[weekly-report-scheduler] invalid cron expr: ${CRON_EXPR}`);
    return;
  }
  task = cron.schedule(CRON_EXPR, async () => {
    try {
      const snap = await weeklyReportService.generateAndSaveSnapshot();
      // eslint-disable-next-line no-console
      console.log(`[weekly-report-scheduler] snapshot saved for ${snap.report_date}`);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[weekly-report-scheduler] snapshot generation failed:', e.message);
    }
  });
  // eslint-disable-next-line no-console
  console.log(`[weekly-report-scheduler] scheduled: ${CRON_EXPR} (every Wednesday 08:00)`);
}

module.exports = { start };
