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

// Local calendar date (not UTC — every scheduler in this codebase runs in
// server local time with no TZ conversion; toISOString() would shift the
// date near midnight in timezones far from UTC).
function todayLocalDate() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// Screenshot row order: Asset Inventory -> Patch Management -> (manual:
// iDRAC/OpenManage, Server Identity) -> Nessus -> (manual: BAU Activities,
// ESXi Patching, SOP, Ticketing, Queries/Challenges) -> Migration Project ->
// (manual: Vulnerability Mitigation, EOL Tracker, Licenses).
async function buildCurrentReport() {
  const [auto, manualRows] = await Promise.all([
    autoSvc.buildAutoSections(),
    manualSvc.listManualSections(),
  ]);
  const manualByKey = new Map(manualRows.map(r => [r.section_key, r]));
  const manualSection = (key) => {
    const r = manualByKey.get(key);
    return r ? { section_key: r.section_key, title: r.title, kind: 'manual', data: { content: r.content } } : null;
  };

  const sections = [
    auto.assetInventory,
    auto.patchManagement,
    manualSection('idrac_openmanage'),
    manualSection('server_identity'),
    auto.nessus,
    manualSection('bau_activities'),
    manualSection('esxi_patching'),
    manualSection('sop'),
    manualSection('ticketing'),
    manualSection('queries_challenges'),
    auto.migration,
    manualSection('migration_narrative'),
    manualSection('vulnerability_mitigation'),
    manualSection('eol_tracker'),
    manualSection('licenses'),
  ].filter(Boolean);

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
