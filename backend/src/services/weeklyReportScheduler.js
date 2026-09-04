/**
 * weeklyReportScheduler.js
 * --------------------------
 * Day/time comes from weekly_report_schedule_config (admin-editable under
 * Admin -> Weekly Report Admin), defaulting to Wednesday 08:00 server local
 * time. reload() is called by the controller right after a schedule save so
 * the new time takes effect immediately, same start/reload shape as
 * backupScheduler.js.
 */
let cron;
try { cron = require('node-cron'); } catch { cron = null; }

const weeklyReportService = require('./weeklyReportService');
const scheduleSvc = require('./weeklyReportScheduleService');

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

let task = null;

async function start() {
  if (!cron) {
    // eslint-disable-next-line no-console
    console.warn('[weekly-report-scheduler] node-cron not installed — automatic Weekly Report snapshots disabled');
    return;
  }
  if (task) { try { task.stop(); } catch { /* ignore */ } task = null; }

  const cfg = await scheduleSvc.getConfig();
  const expr = `${cfg.minute} ${cfg.hour} * * ${cfg.day_of_week}`;
  if (!cron.validate(expr)) {
    // eslint-disable-next-line no-console
    console.warn(`[weekly-report-scheduler] invalid cron expr: ${expr}`);
    return;
  }
  task = cron.schedule(expr, async () => {
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
  console.log(`[weekly-report-scheduler] scheduled: ${expr} (every ${DAY_NAMES[cfg.day_of_week]} ${String(cfg.hour).padStart(2, '0')}:${String(cfg.minute).padStart(2, '0')})`);
}

module.exports = { start, reload: start };
