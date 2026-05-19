const svc = require('../services/builtinPagesService');

async function list(_req, res, next) {
  try { res.json({ items: await svc.list() }); } catch (e) { next(e); }
}

async function update(req, res, next) {
  try { res.json(await svc.update(req.params.pageKey, req.body || {}, req.user?.id)); } catch (e) { next(e); }
}

async function reset(req, res, next) {
  try {
    await svc.reset(req.params.pageKey);
    res.status(204).end();
  } catch (e) { next(e); }
}

module.exports = { list, update, reset };
