const router   = require('express').Router();
const { authorize, requirePageAccess } = require('../middleware/auth');
const c = require('../controllers/complianceConfigController');

router.get('/', requirePageAccess('admin/compliance-config'), c.getConfig);
router.put('/', requirePageAccess('admin/compliance-config'), authorize('admin', 'superadmin'), c.saveConfig);

module.exports = router;
