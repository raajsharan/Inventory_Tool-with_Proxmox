const svc = require('../services/pingMonitorService');

async function getConfig(req, res, next) {
  try { res.json(await svc.getConfig()); } catch (e) { next(e); }
}

async function saveConfig(req, res, next) {
  try {
    res.json(await svc.saveConfig(req.body));
  } catch (e) {
    if (/Invalid window time/.test(e.message)) return res.status(400).json({ error: e.message });
    next(e);
  }
}

module.exports = { getConfig, saveConfig };
