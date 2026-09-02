const router = require('express').Router();
const { authenticate, requirePageAccess } = require('../middleware/auth');
const ctrl = require('../controllers/hostAlertsController');

const guard = [authenticate, requirePageAccess('connectivity_alerts')];

router.get('/summary', ...guard, ctrl.getSummary);
router.get('/list',    ...guard, ctrl.getList);

module.exports = router;
