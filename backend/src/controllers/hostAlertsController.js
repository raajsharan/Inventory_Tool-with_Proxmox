const svc = require('../services/hostAlertsService');

async function getSummary(req, res, next) {
  try {
    res.json(await svc.summary({ days: req.query.days }));
  } catch (e) { next(e); }
}

async function getList(req, res, next) {
  try {
    res.json(await svc.list({ days: req.query.days, page: req.query.page, pageSize: req.query.pageSize }));
  } catch (e) { next(e); }
}

module.exports = { getSummary, getList };
