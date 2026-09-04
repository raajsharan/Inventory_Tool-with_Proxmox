/**
 * weeklyReportService.js
 * ------------------------
 * Merges the auto-computed sections (weeklyReportAutoService) with the
 * current manual sections (weeklyReportManualService) into one ordered
 * report, and manages the archived snapshot history
 * (weekly_report_snapshots — one frozen row per Wednesday, written by
 * weeklyReportScheduler.js).
 */
const db = require('../config/db');
const autoSvc = require('./weeklyReportAutoService');
const manualSvc = require('./weeklyReportManualService');
const teamsNotificationService = require('./teamsNotificationService');

// Local calendar date (not UTC — every scheduler in this codebase runs in
// server local time with no TZ conversion; toISOString() would shift the
// date near midnight in timezones far from UTC).
function todayLocalDate() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// Auto sections carry a fixed sort_order (weeklyReportAutoService.js) that
// interleaves with the manual rows' own sort_order (weekly_report_manual_
// sections, seeded/migrated by ensureSchema.js) — merging by that single
// number instead of a hardcoded key list means a row a user adds or removes
// via the Manage Inputs tab is reflected here with no code change.
async function buildCurrentReport() {
  const [auto, manualRows] = await Promise.all([
    autoSvc.buildAutoSections(),
    manualSvc.listManualSections(),
  ]);

  const sections = [
    ...Object.values(auto),
    ...manualRows.map(r => ({
      section_key: r.section_key,
      title: r.title,
      kind: 'manual',
      sort_order: r.sort_order,
      data: { content: r.content },
    })),
  ].sort((a, b) => a.sort_order - b.sort_order);

  return { reportDate: todayLocalDate(), sections };
}

async function generateAndSaveSnapshot(generatedBy = 'scheduler') {
  const report = await buildCurrentReport();
  const { rows } = await db.query(
    `INSERT INTO weekly_report_snapshots (report_date, sections, generated_by)
     VALUES ($1, $2, $3)
     ON CONFLICT (report_date) DO UPDATE
       SET sections = EXCLUDED.sections, generated_by = EXCLUDED.generated_by, created_at = NOW()
     RETURNING id, report_date, created_at`,
    [report.reportDate, JSON.stringify(report.sections), generatedBy],
  );

  // Single choke point for both the Wednesday scheduler and an admin's
  // manual "Generate Now" — either way a real snapshot was just produced,
  // so Teams should hear about it. Never let a bad/unreachable webhook fail
  // the snapshot that was just successfully saved.
  try {
    await teamsNotificationService.notifyWeeklyReport(report);
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('[weekly-report] Teams webhook notification failed:', e.message);
  }

  return rows[0];
}

async function listSnapshots() {
  const { rows } = await db.query(
    `SELECT id, report_date, generated_by, created_at
       FROM weekly_report_snapshots
      ORDER BY report_date DESC`,
  );
  return rows;
}

async function getSnapshot(id) {
  const { rows } = await db.query(
    `SELECT id, report_date, sections, generated_by, created_at
       FROM weekly_report_snapshots WHERE id = $1`,
    [id],
  );
  return rows[0] || null;
}

module.exports = { buildCurrentReport, generateAndSaveSnapshot, listSnapshots, getSnapshot };
