const router = require('express').Router();
const { authenticate, requirePageAccess, authorize } = require('../middleware/auth');
const ctrl = require('../controllers/softwareStatusController');

const guard      = [authenticate, requirePageAccess('software_status')];
const adminGuard = [authenticate, requirePageAccess('software_status'), authorize('admin', 'superadmin')];

router.get('/',                ...guard,      ctrl.get);
router.post('/verify',         ...guard,      ctrl.verify);
router.get('/install-config',  ...guard,      ctrl.getInstallConfig);
router.put('/install-config',  ...adminGuard, ctrl.saveInstallConfig);
router.post('/install',        ...adminGuard, ctrl.install);
router.get('/install-log',     ...guard,      ctrl.getInstallLog);
router.delete('/install-log',  ...adminGuard, ctrl.clearInstallLog);

module.exports = router;
