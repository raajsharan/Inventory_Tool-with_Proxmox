const svc = require('../services/serverModelsService');

async function list(req, res, next) {
  try { res.json(await svc.list()); } catch (e) { next(e); }
}

async function create(req, res, next) {
  try { res.status(201).json(await svc.create(req.body)); } catch (e) { next(e); }
}

async function update(req, res, next) {
  try { res.json(await svc.update(req.params.id, req.body)); } catch (e) { next(e); }
}

async function remove(req, res, next) {
  try { await svc.remove(req.params.id); res.json({ ok: true }); } catch (e) { next(e); }
}

module.exports = { list, create, update, remove };
