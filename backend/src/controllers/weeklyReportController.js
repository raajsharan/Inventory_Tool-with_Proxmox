const svc = require('../services/weeklyReportService');
const manualSvc = require('../services/weeklyReportManualService');
const scheduleSvc = require('../services/weeklyReportScheduleService');
const scheduler = require('../services/weeklyReportScheduler');

async function getCurrent(req, res, next) {
  try { res.json(await svc.buildCurrentReport()); } catch (e) { next(e); }
}

async function listSnapshots(req, res, next) {
  try { res.json(await svc.listSnapshots()); } catch (e) { next(e); }
}

async function getSnapshot(req, res, next) {
  try {
    const snap = await svc.getSnapshot(req.params.id);
    if (!snap) return res.status(404).json({ error: 'Snapshot not found' });
    res.json(snap);
  } catch (e) { next(e); }
}

async function generateNow(req, res, next) {
  try {
    const snap = await svc.generateAndSaveSnapshot('manual_trigger');
    res.json({ ok: true, snapshot: snap });
  } catch (e) { next(e); }
}

async function deleteSnapshot(req, res, next) {
  try {
    const ok = await svc.deleteSnapshot(req.params.id);
    if (!ok) return res.status(404).json({ error: 'Snapshot not found' });
    res.json({ ok: true });
  } catch (e) { next(e); }
}

async function getSchedule(req, res, next) {
  try { res.json(await scheduleSvc.getConfig()); } catch (e) { next(e); }
}

async function saveSchedule(req, res, next) {
  try {
    const row = await scheduleSvc.saveConfig(req.body || {}, req.user?.id);
    await scheduler.reload();
    res.json(row);
  } catch (e) {
    if (/must be an integer/.test(e.message)) return res.status(400).json({ error: e.message });
    next(e);
  }
}

async function listManualSections(req, res, next) {
  try { res.json(await manualSvc.listManualSections()); } catch (e) { next(e); }
}

async function updateManualSection(req, res, next) {
  try {
    const row = await manualSvc.updateManualSection(req.params.sectionKey, req.body?.content, req.user?.id);
    if (!row) return res.status(404).json({ error: 'Section not found' });
    res.json(row);
  } catch (e) { next(e); }
}

async function createManualSection(req, res, next) {
  try {
    const title = (req.body?.title || '').trim();
    if (!title) return res.status(400).json({ error: 'Title is required' });
    const row = await manualSvc.createManualSection(title, req.body?.content, req.user?.id);
    res.status(201).json(row);
  } catch (e) { next(e); }
}

async function deleteManualSection(req, res, next) {
  try {
    const ok = await manualSvc.deleteManualSection(req.params.sectionKey);
    if (!ok) return res.status(404).json({ error: 'Section not found' });
    res.json({ ok: true });
  } catch (e) { next(e); }
}

const tablesSvc = require('../services/weeklyReportTablesService');
const audit = require('../services/auditService');

// ── Table Settings (WEEKLY_REPORT_CONFIG.md) ──────────────────────────────
// Readable by anyone who can open the report; only admins can save.
async function getTableConfig(req, res, next) {
  try { res.json(await tablesSvc.getAll()); } catch (e) { next(e); }
}

async function saveTableConfig(req, res, next) {
  try {
    const out = await tablesSvc.saveAll(req.body || {}, req.user?.id);
    await audit.log({ user: req.user, action: 'UPDATE', entityType: 'weekly_report_tables',
      entityId: 'config', details: { tables: (req.body?.tables || []).map(t => t.table_key) }, ipAddress: req.ip });
    res.json(out);
  } catch (e) { next(e); }
}

// Builds the report sections from an unsaved draft so an admin can see the
// result before saving. Read-only: nothing is written.
async function previewPivotConfig(req, res, next) {
  try {
    const draft = req.body?.tables;
    if (!Array.isArray(draft)) return res.status(400).json({ error: 'tables array is required' });
    const rules = {};
    for (const t of draft) if (t?.config?.rules) rules[t.table_key] = t.config.rules;
    const auto = await require('../services/weeklyReportAutoService')
      .buildAutoSections({ pivotOverride: rules, skipMigration: true });
    res.json({ sections: auto, detail: await tablesSvc.previewDetail(draft) });
  } catch (e) { next(e); }
}

async function getDetailTables(req, res, next) {
  try { res.json({ tables: await tablesSvc.getDetailTables() }); } catch (e) { next(e); }
}

async function getPivotData(req, res, next) {
  try { res.json(await tablesSvc.getPivotData(req.query.includeDecom === 'true')); } catch (e) { next(e); }
}

async function exportReport(req, res, next) {
  try {
    const q = req.query;
    const pivot = q.rows ? { rows: q.rows, cols: q.cols || '', value: q.value, includeDecom: q.includeDecom === 'true' } : null;
    const stamp = new Date().toISOString().slice(0, 10);
    if (q.format === 'xlsx') {
      const buf = await tablesSvc.exportXlsx({ pivot });
      res.set({ 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="weekly-report-${stamp}.xlsx"` });
      return res.send(Buffer.from(buf));
    }
    res.set({ 'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="weekly-report-${stamp}.csv"` });
    res.send('\uFEFF' + await tablesSvc.exportCsv({ pivot }));
  } catch (e) { next(e); }
}

async function listViews(req, res, next) {
  try { res.json(await tablesSvc.listViews(req.user.id)); } catch (e) { next(e); }
}
async function saveView(req, res, next) {
  try { res.status(201).json(await tablesSvc.saveView(req.user.id, req.body?.name, req.body?.view_config)); } catch (e) { next(e); }
}
async function deleteView(req, res, next) {
  try {
    if (!(await tablesSvc.deleteView(req.user.id, req.params.id))) return res.status(404).json({ error: 'View not found' });
    res.json({ ok: true });
  } catch (e) { next(e); }
}

module.exports = {
  getTableConfig, saveTableConfig, previewPivotConfig, getDetailTables, getPivotData,
  exportReport, listViews, saveView, deleteView,
  getCurrent, listSnapshots, getSnapshot, generateNow, deleteSnapshot,
  listManualSections, updateManualSection, createManualSection, deleteManualSection,
  getSchedule, saveSchedule,
};
