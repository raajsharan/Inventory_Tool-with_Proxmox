const svc = require('../services/teamsNotificationService');

async function getConfig(req, res, next) {
  try { res.json(await svc.getConfig()); } catch (e) { next(e); }
}

async function saveConfig(req, res, next) {
  try { res.json(await svc.saveConfig(req.body)); } catch (e) { next(e); }
}

async function testNotification(req, res, next) {
  try {
    await svc.testNotification(req.body?.webhook_url);
    res.json({ ok: true, message: 'Test notification sent to Teams.' });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
}

module.exports = { getConfig, saveConfig, testNotification };
