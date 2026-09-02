const svc = require('../services/weeklyReportService');
const manualSvc = require('../services/weeklyReportManualService');

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

module.exports = {
  getCurrent, listSnapshots, getSnapshot, generateNow,
  listManualSections, updateManualSection, createManualSection, deleteManualSection,
};
