const audit = require('../services/auditService');

async function list(req, res, next) {
  try {
    res.json(await audit.list({
      page: Number(req.query.page) || 1,
      pageSize: Math.min(Number(req.query.pageSize) || 50, 200),
      action: req.query.action,
      entityType: req.query.entityType,
      entityId: req.query.entityId,
      userId: req.query.userId,
      viewerRole: req.user?.role,
    }));
  } catch (e) { next(e); }
}

module.exports = { list };
