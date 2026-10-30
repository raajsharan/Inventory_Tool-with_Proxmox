const router    = require('express').Router();
const { authenticate, requirePageAccess, authorize } = require('../middleware/auth');
const ctrl      = require('../controllers/endpointCentralController');

const guard      = [authenticate, requirePageAccess('endpoint_central')];
const writeGuard = [authenticate, requirePageAccess('endpoint_central'), authorize('admin', 'asset_manager')];
const adminGuard =[authenticate, requirePageAccess('endpoint_central'), authorize('admin', 'superadmin')];

router.get('/',             ...guard,      ctrl.listAgents);
router.get('/software',     ...guard,      ctrl.listSoftware);

// Custom groups + staged computers (read-only mirror of EC; see ecGroupsService)
router.get('/groups',              ...guard,      ctrl.listGroups);
router.get('/groups/sync',         ...guard,      ctrl.syncStatus);
router.post('/groups/sync',        ...writeGuard, ctrl.startGroupSync);
router.get('/groups/:id/members',  ...guard,      ctrl.groupMembers);
router.get('/staged',              ...guard,      ctrl.listStaged);
router.get('/explore',      ...adminGuard, ctrl.explore);
router.get('/config',       ...guard,      ctrl.getConfig);
router.put('/config',       ...adminGuard, ctrl.saveConfig);
router.post('/check-url',   ...adminGuard, ctrl.checkUrl);
router.post('/test',        ...adminGuard, ctrl.testConnection);
router.post('/login',       ...adminGuard, ctrl.loginWithCredentials);
router.post('/login/otp',   ...adminGuard, ctrl.validateOtp);

module.exports = router;
