const svc = require('../services/assetTransferService');
const audit = require('../services/auditService');

async function listInventories(_req, res) {
  res.json({
    inventories: Object.entries(svc.INVENTORIES).map(([key, v]) => ({ key, label: v.label })),
  });
}

async function preview(req, res, next) {
  try {
    const { source, ids } = req.body || {};
    res.json({ items: await svc.preview({ source, ids }) });
  } catch (e) { next(e); }
}

async function transfer(req, res, next) {
  try {
    const { source, target, ids } = req.body || {};
    const result = await svc.transfer({ source, target, ids }, req.user.id);
    await audit.log({
      user: req.user,
      action: 'TRANSFER',
      entityType: 'asset_transfer',
      entityId: null,
      details: { source, target, moved: result.moved.length, failed: result.failed.length },
      ipAddress: req.ip,
    });
    res.json(result);
  } catch (e) { next(e); }
}

module.exports = { listInventories, preview, transfer };
