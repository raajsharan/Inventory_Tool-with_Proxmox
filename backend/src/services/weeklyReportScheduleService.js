/**
 * weeklyReportScheduleService.js
 * ---------------------------------
 * Admin-configurable day/time for weeklyReportScheduler.js's automatic
 * snapshot (singleton row, same shape as backupService's schedule settings).
 */
const db = require('../config/db');

const DEFAULTS = { day_of_week: 3, hour: 8, minute: 0 };

async function getConfig() {
  const { rows } = await db.query(
    `SELECT day_of_week, hour, minute, updated_at FROM weekly_report_schedule_config WHERE id = 1`,
  );
  return rows[0] || { ...DEFAULTS, updated_at: null };
}

async function saveConfig({ day_of_week, hour, minute }, userId) {
  const dow = Number(day_of_week);
  const hh = Number(hour);
  const mm = Number(minute);
  if (!Number.isInteger(dow) || dow < 0 || dow > 6) throw new Error('day_of_week must be an integer 0-6 (Sunday-Saturday)');
  if (!Number.isInteger(hh) || hh < 0 || hh > 23) throw new Error('hour must be an integer 0-23');
  if (!Number.isInteger(mm) || mm < 0 || mm > 59) throw new Error('minute must be an integer 0-59');

  const { rows } = await db.query(
    `INSERT INTO weekly_report_schedule_config (id, day_of_week, hour, minute, updated_by, updated_at)
     VALUES (1, $1, $2, $3, $4, NOW())
     ON CONFLICT (id) DO UPDATE
       SET day_of_week = EXCLUDED.day_of_week, hour = EXCLUDED.hour, minute = EXCLUDED.minute,
           updated_by = EXCLUDED.updated_by, updated_at = NOW()
     RETURNING day_of_week, hour, minute, updated_at`,
    [dow, hh, mm, userId || null],
  );
  return rows[0];
}

module.exports = { getConfig, saveConfig };
