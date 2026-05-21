const svc = require('../services/inventoryFieldsService');

async function get(req, res, next) {
  try { res.json(await svc.get(req.params.pageKey)); } catch (e) { next(e); }
}

async function bulkUpdateOverrides(req, res, next) {
  try {
    const updates = Array.isArray(req.body.updates) ? req.body.updates : [];
    const groups  = Array.isArray(req.body.groups)  ? req.body.groups  : null;
    if (updates.length) {
      await svc.upsertOverrides(req.params.pageKey, updates, req.user?.id);
    }
    if (groups) {
      return res.json(await svc.setGroups(req.params.pageKey, groups, req.user?.id));
    }
    res.json(await svc.get(req.params.pageKey));
  } catch (e) { next(e); }
}

async function createExtra(req, res, next) {
  try { res.json(await svc.createExtra(req.params.pageKey, req.body || {}, req.user?.id)); }
  catch (e) { next(e); }
}

async function updateExtra(req, res, next) {
  try { res.json(await svc.updateExtra(req.params.pageKey, req.params.fieldKey, req.body || {}, req.user?.id)); }
  catch (e) { next(e); }
}

async function deleteExtra(req, res, next) {
  try {
    await svc.deleteExtra(req.params.pageKey, req.params.fieldKey);
    res.status(204).end();
  } catch (e) { next(e); }
}

async function resetField(req, res, next) {
  try { res.json(await svc.resetField(req.params.pageKey, req.params.fieldKey)); } catch (e) { next(e); }
}

module.exports = { get, bulkUpdateOverrides, createExtra, updateExtra, deleteExtra, resetField };
