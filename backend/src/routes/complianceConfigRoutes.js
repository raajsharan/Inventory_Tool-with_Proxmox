const router   = require('express').Router();
const { authorize } = require('../middleware/auth');
const c = require('../controllers/complianceConfigController');

router.get('/', c.getConfig);
router.put('/', authorize('admin', 'superadmin'), c.saveConfig);

module.exports = router;
