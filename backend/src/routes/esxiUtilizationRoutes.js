const router = require('express').Router();
const { authenticate, requirePageAccess } = require('../middleware/auth');
const svc = require('../services/esxiUtilizationService');

// Read-only; anyone with access to the ESXi Utilization page may see it.
const guard = [authenticate, requirePageAccess('esxi_utilization')];

router.get('/', ...guard, async (req, res, next) => {
  try { res.json(await svc.getCapacity()); } catch (e) { next(e); }
});

module.exports = router;
