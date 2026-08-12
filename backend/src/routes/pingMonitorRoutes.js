const router = require('express').Router();
const { authenticate, authorize } = require('../middleware/auth');
const c = require('../controllers/pingMonitorController');

router.get('/', authenticate, c.getConfig);
router.put('/', authenticate, authorize('admin', 'superadmin'), c.saveConfig);

module.exports = router;
