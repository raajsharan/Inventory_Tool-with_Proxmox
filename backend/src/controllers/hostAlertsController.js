const svc = require('../services/hostAlertsService');

async function getSummary(req, res, next) {
  try {
    res.json(await svc.summary({ days: req.query.days }));
  } catch (e) { next(e); }
}

module.exports = { getSummary };
