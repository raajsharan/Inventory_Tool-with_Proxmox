const svc = require('../services/recycleBinService');
const audit = require('../services/auditService');
const ApiError = require('../utils/ApiError');
const { verifyCurrentPassword } = require('../utils/verifyPassword');

async function list(req, res, next) {
  try {
    res.json({
      items: await svc.list({ type: req.query.type, search: req.query.search }),
    });
  } catch (e) { next(e); }
}

async function restore(req, res, next) {
  try {
    const result = await svc.restore(req.params.type, req.params.id, req.user.id);
    await audit.log({
      user: req.user, action: 'RESTORE',
      entityType: req.params.type, entityId: req.params.id, ipAddress: req.ip,
    });
    res.json(result);
  } catch (e) { next(e); }
}

async function purge(req, res, next) {
  try {
    if (req.user.role !== 'superadmin') {
      throw new ApiError(403, 'Only the superadmin can permanently delete items.');
    }
    await verifyCurrentPassword(req.user.id, req.body?.password);
    const result = await svc.purge(req.params.type, req.params.id);
    await audit.log({
      user: req.user, action: 'PURGE',
      entityType: req.params.type, entityId: req.params.id, ipAddress: req.ip,
    });
    res.json(result);
  } catch (e) { next(e); }
}

async function emptyAll(req, res, next) {
  try {
    if (req.user.role !== 'superadmin') {
      throw new ApiError(403, 'Only the superadmin can empty the recycle bin.');
    }
    await verifyCurrentPassword(req.user.id, req.body?.password);
    const counts = await svc.emptyAll();
    await audit.log({
      user: req.user, action: 'PURGE',
      entityType: 'recycle_bin', details: counts, ipAddress: req.ip,
    });
    res.json({ ok: true, counts });
  } catch (e) { next(e); }
}

module.exports = { list, restore, purge, emptyAll };
