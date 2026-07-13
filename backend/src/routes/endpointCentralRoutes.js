const router    = require('express').Router();
const { authenticate, requirePageAccess, authorize } = require('../middleware/auth');
const ctrl      = require('../controllers/endpointCentralController');

const guard      = [authenticate, requirePageAccess('endpoint_central')];
const adminGuard = [authenticate, requirePageAccess('endpoint_central'), authorize('admin', 'superadmin')];

router.get('/',             ...guard,      ctrl.listAgents);
router.get('/software',     ...guard,      ctrl.listSoftware);
router.get('/config',       ...guard,      ctrl.getConfig);
router.put('/config',       ...adminGuard, ctrl.saveConfig);
router.post('/test',        ...adminGuard, ctrl.testConnection);
router.post('/login',       ...adminGuard, ctrl.loginWithCredentials);
router.post('/login/otp',   ...adminGuard, ctrl.validateOtp);

module.exports = router;
