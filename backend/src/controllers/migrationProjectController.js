const svc = require('../services/migrationService');

async function listProjects(req, res, next) {
  try { res.json(await svc.listProjectsWithStats()); } catch (e) { next(e); }
}

async function createProject(req, res, next) {
  try {
    const project = await svc.createProject(req.body);
    res.status(201).json(project);
  } catch (e) {
    if (e.message === 'Project name is required') return res.status(400).json({ error: e.message });
    next(e);
  }
}

async function updateProject(req, res, next) {
  try {
    const row = await svc.updateProject(req.params.id, req.body);
    if (!row) return res.status(404).json({ error: 'Project not found' });
    res.json(row);
  } catch (e) { next(e); }
}

async function deleteProject(req, res, next) {
  try {
    await svc.deleteProject(req.params.id);
    res.json({ ok: true });
  } catch (e) {
    if (/Cannot delete|not found/i.test(e.message)) return res.status(400).json({ error: e.message });
    next(e);
  }
}

// ── CUSTOM TAB CRUD ───────────────────────────────────────────────────────────

async function listCustomTabs(req, res, next) {
  try { res.json(await svc.getCustomTabs(req.params.id)); } catch (e) { next(e); }
}

async function createCustomTab(req, res, next) {
  try {
    const tab = await svc.createCustomTab(req.params.id, req.body);
    res.status(201).json(tab);
  } catch (e) {
    if (e.message === 'Tab label is required' || e.message === 'Invalid project_id')
      return res.status(400).json({ error: e.message });
    next(e);
  }
}

async function updateCustomTab(req, res, next) {
  try {
    const tab = await svc.updateCustomTab(req.params.tabId, req.body);
    if (!tab) return res.status(404).json({ error: 'Custom tab not found' });
    res.json(tab);
  } catch (e) { next(e); }
}

async function deleteCustomTab(req, res, next) {
  try {
    await svc.deleteCustomTab(req.params.tabId);
    res.json({ ok: true });
  } catch (e) { next(e); }
}

async function getTabConfig(req, res, next) {
  try {
    const cfg = await svc.getTabConfig(req.params.id);
    res.json(cfg);
  } catch (e) { next(e); }
}

async function saveTabConfig(req, res, next) {
  try {
    const cfg = await svc.saveTabConfigs(req.params.id, req.body);
    res.json(cfg);
  } catch (e) {
    if (e.message === 'Invalid project_id') return res.status(400).json({ error: e.message });
    next(e);
  }
}

// ── FIELD DEFINITIONS ─────────────────────────────────────────────────────────

async function listFieldDefs(req, res, next) {
  try { res.json(await svc.getFieldDefs(req.params.id, req.query.tab_key)); } catch (e) { next(e); }
}

async function createFieldDef(req, res, next) {
  try {
    const fd = await svc.createFieldDef(req.params.id, req.body.tab_key, req.body);
    res.status(201).json(fd);
  } catch (e) {
    if (/label is required|Invalid project/.test(e.message)) return res.status(400).json({ error: e.message });
    next(e);
  }
}

async function updateFieldDef(req, res, next) {
  try {
    const fd = await svc.updateFieldDef(req.params.defId, req.body);
    if (!fd) return res.status(404).json({ error: 'Field definition not found' });
    res.json(fd);
  } catch (e) { next(e); }
}

async function deleteFieldDef(req, res, next) {
  try {
    await svc.deleteFieldDef(req.params.defId);
    res.json({ ok: true });
  } catch (e) { next(e); }
}

module.exports = {
  listProjects, createProject, updateProject, deleteProject,
  getTabConfig, saveTabConfig,
  listCustomTabs, createCustomTab, updateCustomTab, deleteCustomTab,
  listFieldDefs, createFieldDef, updateFieldDef, deleteFieldDef,
};
