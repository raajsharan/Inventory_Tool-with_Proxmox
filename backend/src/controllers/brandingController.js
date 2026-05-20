const svc = require('../services/brandingService');
const audit = require('../services/auditService');

async function getBranding(_req, res, next) {
  try { res.json(await svc.get()); } catch (e) { next(e); }
}

async function updateBranding(req, res, next) {
  try {
    const row = await svc.update(req.body, req.user.id);
    await audit.log({ user: req.user, action: 'UPDATE', entityType: 'branding', ipAddress: req.ip });
    res.json(row);
  } catch (e) { next(e); }
}

module.exports = { getBranding, updateBranding };
