const svc   = require('../services/assetService');
const audit  = require('../services/auditService');
const teams  = require('../services/teamsNotificationService');

async function list(req, res, next) {
  try {
    const result = await svc.list({
      search: req.query.search,
      osType: req.query.osType,
      serverStatus: req.query.serverStatus,
      location: req.query.location,
      eolStatus: req.query.eolStatus,
      department: req.query.department,
      page: Number(req.query.page) || 1,
      pageSize: Math.min(Number(req.query.pageSize) || 20, 200),
      sortBy: req.query.sortBy,
      sortDir: req.query.sortDir,
    });
    res.json(result);
  } catch (e) { next(e); }
}

async function get(req, res, next) {
  try { res.json(await svc.get(req.params.id)); } catch (e) { next(e); }
}

async function create(req, res, next) {
  try {
    const asset = await svc.create(req.body, req.user.id);
    await audit.log({ user: req.user, action: 'CREATE', entityType: 'asset', entityId: asset.id, details: { vm_name: asset.vm_name }, ipAddress: req.ip });
    teams.notifyNewAsset(asset, 'assets', req.user?.full_name || req.user?.email).catch(() => {});
    res.status(201).json(asset);
  } catch (e) { next(e); }
}

async function update(req, res, next) {
  try {
    const asset = await svc.update(req.params.id, req.body, req.user.id);
    await audit.log({ user: req.user, action: 'UPDATE', entityType: 'asset', entityId: asset.id, details: { vm_name: asset.vm_name }, ipAddress: req.ip });
    teams.notifyAssetUpdate(asset, 'assets', req.user?.full_name || req.user?.email).catch(() => {});
    res.json(asset);
  } catch (e) { next(e); }
}

async function remove(req, res, next) {
  try {
    const { verifyCurrentPassword } = require('../utils/verifyPassword');
    await verifyCurrentPassword(req.user.id, req.body?.password);
    await svc.remove(req.params.id, req.user.id);
    await audit.log({ user: req.user, action: 'DELETE', entityType: 'asset', entityId: req.params.id, ipAddress: req.ip });
    res.status(204).end();
  } catch (e) { next(e); }
}

async function tagStats(req, res, next) {
  try {
    res.json(await svc.tagStats(req.query.department));
  } catch (e) { next(e); }
}

async function viewPassword(req, res, next) {
  try {
    const password = await svc.viewPassword(req.params.id);
    await audit.log({ user: req.user, action: 'VIEW_PASSWORD', entityType: 'asset', entityId: req.params.id, ipAddress: req.ip });
    res.json({ password: password || '' });
  } catch (e) { next(e); }
}

async function checkIp(req, res, next) {
  try {
    const dept = require('../services/departmentService');
    const ip = String(req.query.ip || '').trim();
    if (!ip) return res.json({ used: false, conflictTable: null });
    const conflict = await dept.isIpUsedAnywhere(ip, {
      excludeTable: req.query.excludeTable || undefined,
      excludeId: req.query.excludeId || undefined,
    });
    res.json({ used: !!conflict, conflictTable: conflict });
  } catch (e) { next(e); }
}

module.exports = { list, get, create, update, remove, tagStats, checkIp, viewPassword };
