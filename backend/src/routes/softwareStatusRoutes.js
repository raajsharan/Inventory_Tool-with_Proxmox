const router = require('express').Router();
const { authenticate, requirePageAccess, authorize, requireAgentManageAccess } = require('../middleware/auth');
const ctrl = require('../controllers/softwareStatusController');

const guard      = [authenticate, requirePageAccess('software_status')];
const adminGuard = [authenticate, requirePageAccess('software_status'), authorize('admin', 'superadmin')];
// Install/Reinstall specifically also admit users granted the can_manage_agents
// flag (Administration > Password & Page Control), not just admin/superadmin.
const agentGuard = [authenticate, requirePageAccess('software_status'), requireAgentManageAccess];

router.get('/',                ...guard,      ctrl.get);
router.post('/verify',         ...guard,      ctrl.verify);
router.get('/install-config',           ...guard,      ctrl.getInstallConfig);
router.get('/install-config/locations', ...guard,      ctrl.getInstallConfigLocations);
router.put('/install-config',           ...adminGuard, ctrl.saveInstallConfig);
router.delete('/install-config',        ...adminGuard, ctrl.deleteLocationConfig);
router.post('/install',        ...agentGuard, ctrl.install);
router.post('/reinstall',      ...agentGuard, ctrl.reinstall);
router.get('/install-log',     ...guard,      ctrl.getInstallLog);
router.delete('/install-log',  ...adminGuard, ctrl.clearInstallLog);

module.exports = router;
