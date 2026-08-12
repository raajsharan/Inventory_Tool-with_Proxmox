const svc = require('../services/pingMonitorService');

async function getConfig(req, res, next) {
  try { res.json(await svc.getConfig()); } catch (e) { next(e); }
}

async function saveConfig(req, res, next) {
  try { res.json(await svc.saveConfig(req.body)); } catch (e) { next(e); }
}

module.exports = { getConfig, saveConfig };
