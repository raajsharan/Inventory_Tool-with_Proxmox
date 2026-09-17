const svc = require('../services/customTopologyService');

async function list(req, res, next) {
  try { res.json(await svc.list(req.query.platform)); } catch (e) { next(e); }
}

async function get(req, res, next) {
  try { res.json(await svc.get(req.params.id)); } catch (e) { next(e); }
}

async function create(req, res, next) {
  try {
    const diagram = await svc.create(req.body, req.user.id);
    res.status(201).json(diagram);
  } catch (e) { next(e); }
}

async function update(req, res, next) {
  try {
    const diagram = await svc.update(req.params.id, req.body, req.user.id);
    res.json(diagram);
  } catch (e) { next(e); }
}

async function remove(req, res, next) {
  try {
    await svc.remove(req.params.id);
    res.status(204).end();
  } catch (e) { next(e); }
}

module.exports = { list, get, create, update, remove };
