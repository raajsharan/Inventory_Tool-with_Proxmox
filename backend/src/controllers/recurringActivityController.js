const ApiError = require('../utils/ApiError');
const svc = require('../services/recurringActivityService');

async function getMyTasks(req, res, next) {
  try {
    res.json(await svc.getMyTasks(req.user));
  } catch (e) { next(e); }
}

async function getReckoner(req, res, next) {
  try {
    res.json(await svc.getReckoner());
  } catch (e) { next(e); }
}

async function getConfig(req, res, next) {
  try {
    res.json(await svc.getConfig());
  } catch (e) { next(e); }
}

async function saveConfig(req, res, next) {
  try {
    const { config } = req.body || {};
    if (!config || typeof config !== 'object' || Array.isArray(config)) {
      throw new ApiError(400, 'config object is required');
    }
    if (!Array.isArray(config.team) || !config.team.length) {
      throw new ApiError(400, 'At least one team member is required');
    }
    res.json(await svc.saveConfig(config, req.user.id));
  } catch (e) { next(e); }
}

async function listOverrides(req, res, next) {
  try {
    res.json({ items: await svc.listOverrides(req.query.frequency) });
  } catch (e) { next(e); }
}

async function addOverride(req, res, next) {
  try {
    const { frequency, periodKey, activityKey, assignedTo, reason } = req.body || {};
    if (!['monthly', 'weekly'].includes(frequency)) throw new ApiError(400, 'frequency must be "monthly" or "weekly"');
    if (!periodKey || !activityKey || !assignedTo) throw new ApiError(400, 'periodKey, activityKey, and assignedTo are required');
    res.json(await svc.addOverride({ frequency, periodKey, activityKey, assignedTo, reason }, req.user.id));
  } catch (e) { next(e); }
}

async function removeOverride(req, res, next) {
  try {
    const removed = await svc.removeOverride(req.params.id);
    if (!removed) throw new ApiError(404, 'Override not found');
    res.status(204).end();
  } catch (e) { next(e); }
}

module.exports = {
  getMyTasks, getReckoner, getConfig, saveConfig,
  listOverrides, addOverride, removeOverride,
};
