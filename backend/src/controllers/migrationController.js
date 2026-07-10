const multer = require('multer');
const svc    = require('../services/migrationService');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

// ── PROJECTS ─────────────────────────────────────────────────────────────────
async function listProjects(req, res, next) {
  try { res.json(await svc.getProjects()); } catch (e) { next(e); }
}

async function getTabConfig(req, res, next) {
  try { res.json(await svc.getTabConfig(req.query.project_id)); } catch (e) { next(e); }
}

async function listCustomTabs(req, res, next) {
  try { res.json(await svc.getCustomTabs(req.query.project_id)); } catch (e) { next(e); }
}

async function getFieldDefs(req, res, next) {
  try { res.json(await svc.getFieldDefs(req.query.project_id, req.query.tab_key)); } catch (e) { next(e); }
}

async function getFieldValues(req, res, next) {
  try {
    const ids = (req.query.record_ids || '').split(',').filter(Boolean);
    res.json(await svc.getFieldValues(req.query.record_type, ids));
  } catch (e) { next(e); }
}

async function setFieldValue(req, res, next) {
  try {
    const { field_def_id, record_type, record_id, value } = req.body;
    res.json(await svc.setFieldValue(field_def_id, record_type, record_id, value));
  } catch (e) { next(e); }
}

// ── CUSTOM VMs ────────────────────────────────────────────────────────────────
async function listCustomVMs(req, res, next) {
  try { res.json(await svc.listCustomVMs(req.query)); } catch (e) { next(e); }
}

async function customVMSummary(req, res, next) {
  try { res.json(await svc.customVMSummary(req.query.tab_id)); } catch (e) { next(e); }
}

async function patchCustomVM(req, res, next) {
  try {
    const row = await svc.patchCustomVM(req.params.id, req.body);
    if (!row) return res.status(404).json({ error: 'VM not found' });
    res.json(row);
  } catch (e) { next(e); }
}

async function customFilterOptions(req, res, next) {
  try { res.json(await svc.customFilterOptions(req.query.tab_id)); } catch (e) { next(e); }
}

// ── OVERVIEW ─────────────────────────────────────────────────────────────────
async function overview(req, res, next) {
  try { res.json(await svc.overview(req.query.project_id)); } catch (e) { next(e); }
}

// ── HOSTS ─────────────────────────────────────────────────────────────────────
async function listHosts(req, res, next) {
  try { res.json(await svc.listHosts(req.query)); } catch (e) { next(e); }
}

async function hostsSummary(req, res, next) {
  try { res.json(await svc.hostsSummary(req.query.project_id)); } catch (e) { next(e); }
}

async function getHostCredentials(req, res, next) {
  try {
    if (!req.user?.can_view_passwords) return res.status(403).json({ error: 'Credential access not permitted for your account.' });
    const creds = await svc.getHostCredentials(req.params.id);
    if (!creds) return res.status(404).json({ error: 'Host not found' });
    res.json(creds);
  } catch (e) { next(e); }
}

async function patchHost(req, res, next) {
  try {
    const row = await svc.patchHost(req.params.id, req.body);
    if (!row) return res.status(404).json({ error: 'Host not found or no valid fields provided' });
    res.json({ ok: true });
  } catch (e) { next(e); }
}

// ── BOMGAR VMs ────────────────────────────────────────────────────────────────
async function listBomgar(req, res, next) {
  try { res.json(await svc.listBomgarVMs(req.query)); } catch (e) { next(e); }
}
async function bomgarSummary(req, res, next) {
  try { res.json(await svc.bomgarSummary(req.query.project_id)); } catch (e) { next(e); }
}
async function patchBomgar(req, res, next) {
  try {
    const row = await svc.patchBomgarVM(req.params.id, req.body);
    if (!row) return res.status(404).json({ error: 'Record not found' });
    res.json({ ok: true });
  } catch (e) { next(e); }
}

// ── SECURITY VMs ──────────────────────────────────────────────────────────────
async function listSecurity(req, res, next) {
  try { res.json(await svc.listSecurityVMs(req.query)); } catch (e) { next(e); }
}
async function securitySummary(req, res, next) {
  try { res.json(await svc.securitySummary(req.query.project_id)); } catch (e) { next(e); }
}
async function patchSecurity(req, res, next) {
  try {
    const row = await svc.patchSecurityVM(req.params.id, req.body);
    if (!row) return res.status(404).json({ error: 'Record not found' });
    res.json({ ok: true });
  } catch (e) { next(e); }
}

// ── STANDALONE ESXi ───────────────────────────────────────────────────────────
async function listStandalone(req, res, next) {
  try { res.json(await svc.listStandaloneVMs(req.query)); } catch (e) { next(e); }
}
async function standaloneSummary(req, res, next) {
  try { res.json(await svc.standaloneSummary(req.query.project_id)); } catch (e) { next(e); }
}
async function patchStandalone(req, res, next) {
  try {
    const row = await svc.patchStandaloneVM(req.params.id, req.body);
    if (!row) return res.status(404).json({ error: 'Record not found' });
    res.json({ ok: true });
  } catch (e) { next(e); }
}

// ── FILTER OPTIONS ────────────────────────────────────────────────────────────
async function filterOptions(req, res, next) {
  try { res.json(await svc.filterOptions(req.params.type, req.query.project_id)); } catch (e) { next(e); }
}

// ── CSV EXPORT ────────────────────────────────────────────────────────────────
async function csvExport(req, res, next) {
  try {
    const rows = await svc.exportCSV(req.params.type, req.query);
    const clean = rows.map(r => { const c = { ...r }; delete c.idrac_username_enc; delete c.idrac_password_enc; return c; });

    if (!clean.length) { res.setHeader('Content-Type', 'text/csv'); return res.send('No data'); }
    const header = Object.keys(clean[0]).join(',');
    const csvRows = clean.map(r =>
      Object.values(r).map(v => {
        if (v == null) return '';
        const s = String(v);
        return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s;
      }).join(',')
    );
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="migration-${req.params.type}.csv"`);
    res.send([header, ...csvRows].join('\n'));
  } catch (e) { next(e); }
}

// ── IMPORT ────────────────────────────────────────────────────────────────────
const uploadMiddleware = upload.single('file');

async function importPreview(req, res, next) {
  uploadMiddleware(req, res, async (err) => {
    if (err) return next(err);
    try {
      if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
      res.json({ ok: true, preview: await svc.previewImport(req.file.buffer, req.body?.project_id || null) });
    } catch (e) { next(e); }
  });
}

async function importConfirm(req, res, next) {
  uploadMiddleware(req, res, async (err) => {
    if (err) return next(err);
    try {
      if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
      const projectId = req.body?.project_id;
      if (!projectId) return res.status(400).json({ error: 'project_id is required' });
      const preserveStatus = req.body?.preserve_status === 'true' || req.body?.preserve_status === true;
      const counts = await svc.confirmImport(req.file.buffer, preserveStatus, projectId);
      res.json({ ok: true, counts });
    } catch (e) { next(e); }
  });
}

module.exports = {
  listProjects, getTabConfig, listCustomTabs,
  getFieldDefs, getFieldValues, setFieldValue,
  overview,
  listHosts, hostsSummary, getHostCredentials, patchHost,
  listBomgar, bomgarSummary, patchBomgar,
  listSecurity, securitySummary, patchSecurity,
  listStandalone, standaloneSummary, patchStandalone,
  listCustomVMs, customVMSummary, patchCustomVM, customFilterOptions,
  filterOptions, csvExport,
  importPreview, importConfirm,
};
