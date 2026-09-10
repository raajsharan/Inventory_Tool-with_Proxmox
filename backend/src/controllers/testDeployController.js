const svc = require('../services/testDeployService');
const ApiError = require('../utils/ApiError');

async function listAssets(req, res, next) {
  try { res.json({ assets: await svc.listAssets() }); } catch (e) { next(e); }
}

async function listLocations(req, res, next) {
  try { res.json({ locations: await svc.listLocations() }); } catch (e) { next(e); }
}

async function getConfig(req, res, next) {
  try {
    const location = (req.query.location || '').trim();
    const merged = String(req.query.merged || '') === 'true';
    if (location && merged) return res.json(await svc.getMergedConfig(location));
    if (location) return res.json((await svc.getLocationConfig(location)) || { location });
    res.json(await svc.getConfig());
  } catch (e) { next(e); }
}

async function saveConfig(req, res, next) {
  try { res.json(await svc.saveConfig(req.body, req.user.id)); } catch (e) { next(e); }
}

async function deleteConfig(req, res, next) {
  try {
    const location = (req.query.location || '').trim();
    if (!location) throw new ApiError(400, 'location is required');
    await svc.deleteLocationConfig(location);
    res.json({ deleted: true, location });
  } catch (e) { next(e); }
}

async function verify(req, res, next) {
  try {
    const { source, ip_address } = req.body || {};
    if (!source || !ip_address) throw new ApiError(400, 'source and ip_address are required');
    res.json(await svc.verifyTarget({ source, ip_address }));
  } catch (e) { next(e); }
}

async function createRun(req, res, next) {
  try {
    const targets = req.body?.targets;
    if (!Array.isArray(targets) || !targets.length) throw new ApiError(400, 'targets is required');
    res.json(await svc.startRun(targets, req.user.id));
  } catch (e) { next(e); }
}

async function listRuns(req, res, next) {
  try { res.json({ runs: await svc.listRuns() }); } catch (e) { next(e); }
}

async function getRun(req, res, next) {
  try {
    const run = await svc.getRun(req.params.id);
    if (!run) throw new ApiError(404, 'Run not found');
    res.json(run);
  } catch (e) { next(e); }
}

module.exports = { listAssets, listLocations, getConfig, saveConfig, deleteConfig, verify, createRun, listRuns, getRun };
