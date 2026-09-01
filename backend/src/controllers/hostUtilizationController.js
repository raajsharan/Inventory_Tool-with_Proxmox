const svc = require('../services/hostUtilizationService');

async function getSummary(req, res, next) {
  try {
    const [current, history, config] = await Promise.all([
      svc.getCurrentHighUtilization(),
      svc.summary({ days: req.query.days }),
      svc.getConfig(),
    ]);
    res.json({
      current, history,
      config: { cpu_threshold_pct: config.cpu_threshold_pct, memory_threshold_pct: config.memory_threshold_pct },
    });
  } catch (e) { next(e); }
}

module.exports = { getSummary };
