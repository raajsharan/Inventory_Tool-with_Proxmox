const router = require('express').Router();
const { authorize } = require('../middleware/auth');
const ctrl = require('../controllers/testDeployController');

const adminGuard = authorize('admin', 'superadmin');

router.get('/assets',    ctrl.listAssets);
router.get('/locations', ctrl.listLocations);
router.get('/config',    ctrl.getConfig);
router.put('/config',    adminGuard, ctrl.saveConfig);
router.delete('/config', adminGuard, ctrl.deleteConfig);
router.post('/verify',   ctrl.verify);
router.post('/runs',     ctrl.createRun);
router.get('/runs',      ctrl.listRuns);
router.get('/runs/:id',  ctrl.getRun);

module.exports = router;
