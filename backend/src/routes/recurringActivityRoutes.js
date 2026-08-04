const router = require('express').Router();
const { authorize } = require('../middleware/auth');
const ctrl = require('../controllers/recurringActivityController');

// Available to any authenticated user — their own tasks only.
router.get('/my-tasks', ctrl.getMyTasks);

// The full Ready Reckoner (everyone's assignments, workload balance,
// config, overrides) and any changes to it are admin-only.
const adminOnly = authorize('admin');

router.get('/reckoner',        adminOnly, ctrl.getReckoner);
router.get('/config',          adminOnly, ctrl.getConfig);
router.put('/config',          adminOnly, ctrl.saveConfig);
router.get('/overrides',       adminOnly, ctrl.listOverrides);
router.post('/overrides',      adminOnly, ctrl.addOverride);
router.delete('/overrides/:id', adminOnly, ctrl.removeOverride);

module.exports = router;
