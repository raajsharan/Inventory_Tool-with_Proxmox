/**
 * alertsController.js
 * -------------------
 * HTTP handler for the dashboard alert bell (discovery failures across
 * VMware, Proxmox, and Hyper-V).
 */

const alertsSvc = require('../services/alertsService');

async function getAlerts(req, res, next) {
  try {
    const alerts = await alertsSvc.getFailedHosts();
    res.json({ alerts, count: alerts.length });
  } catch (e) { next(e); }
}

module.exports = { getAlerts };
