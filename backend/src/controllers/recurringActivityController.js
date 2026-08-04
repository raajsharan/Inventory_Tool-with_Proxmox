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

// Status/planned/completed-date updates are allowed for admins, or for
// whoever is actually assigned to that exact period + activity right now
// (shared activities are "assigned" to everyone on the team). Reassigning
// *who* owns a task stays admin-only, via the overrides endpoints above.
async function updateStatus(req, res, next) {
  try {
    const { frequency, periodKey, activityKey, status, plannedDate, completedDate } = req.body || {};
    if (!['monthly', 'weekly'].includes(frequency)) throw new ApiError(400, 'frequency must be "monthly" or "weekly"');
    if (!periodKey || !activityKey) throw new ApiError(400, 'periodKey and activityKey are required');
    if (status && !['not_started', 'in_progress', 'completed'].includes(status)) {
      throw new ApiError(400, 'status must be one of not_started, in_progress, completed');
    }

    const isAdmin = ['admin', 'superadmin'].includes(req.user.role);
    if (!isAdmin) {
      const allowed = await svc.canUpdateStatus(req.user, frequency, periodKey, activityKey);
      if (!allowed) throw new ApiError(403, 'You can only update the status of your own tasks');
    }

    res.json(await svc.setStatus({ frequency, periodKey, activityKey, status, plannedDate, completedDate }, req.user.id));
  } catch (e) { next(e); }
}

module.exports = {
  getMyTasks, getReckoner, getConfig, saveConfig,
  listOverrides, addOverride, removeOverride,
  updateStatus,
};
