const router = require('express').Router();
const { authenticate, requirePageAccess, authorize, requireAgentManageAccess } = require('../middleware/auth');
const ctrl = require('../controllers/nessusStatusController');

const guard      = [authenticate, requirePageAccess('nessus_status')];
const adminGuard = [authenticate, requirePageAccess('nessus_status'), authorize('admin', 'superadmin')];
// Install specifically also admits users granted the can_manage_agents flag
// (Administration > Password & Page Control), not just admin/superadmin.
const agentGuard = [authenticate, requirePageAccess('nessus_status'), requireAgentManageAccess];

router.get('/',                ...guard,      ctrl.get);
router.post('/verify',         ...guard,      ctrl.verify);
router.post('/service-action', ...adminGuard, ctrl.serviceAction);
router.get('/install-config',  ...guard,      ctrl.getInstallConfig);
router.put('/install-config',  ...adminGuard, ctrl.saveInstallConfig);
router.post('/install',        ...agentGuard, ctrl.install);
router.get('/install-log',     ...guard,      ctrl.getInstallLog);
router.delete('/install-log',  ...adminGuard, ctrl.clearInstallLog);
router.post('/cleanup-non-applicable', ...adminGuard, ctrl.cleanupNonApplicable);

module.exports = router;
