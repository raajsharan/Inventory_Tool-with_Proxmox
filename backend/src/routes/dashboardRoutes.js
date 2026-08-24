const router = require('express').Router();
const { authenticate, authorize } = require('../middleware/auth');
const c = require('../controllers/dashboardController');

router.get('/summary', authenticate, c.summary);
router.get('/config',  authenticate, c.getConfig);
router.get('/widget-data', authenticate, c.widgetData);
router.get('/new-vms',     authenticate, c.getNewVMs);
router.get('/weekly-nessus-applicability', authenticate, c.getWeeklyNessusApplicabilityDetail);
router.put('/config',  authenticate, authorize('admin', 'superadmin'), c.saveConfig);

module.exports = router;
