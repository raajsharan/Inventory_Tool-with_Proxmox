const router = require('express').Router();
const { authenticate, authorize } = require('../middleware/auth');
const ctrl = require('../controllers/hypervController');

const admin = authorize('admin', 'superadmin');

router.get('/hosts',              authenticate, ctrl.listHosts);
router.post('/hosts',             authenticate, admin, ctrl.addHost);
router.put('/hosts/:id',          authenticate, admin, ctrl.updateHost);
router.delete('/hosts/:id',       authenticate, admin, ctrl.removeHost);
router.post('/hosts/:id/test',    authenticate, admin, ctrl.testHost);
router.post('/hosts/:id/run',     authenticate, admin, ctrl.triggerRun);

router.get('/vms',        authenticate, ctrl.listVMs);
router.get('/dashboard',  authenticate, ctrl.getDashboard);
router.get('/drift',      authenticate, ctrl.getDrift);
router.get('/stale',      authenticate, ctrl.getStale);
router.get('/snapshots',  authenticate, ctrl.getSnapshots);
router.get('/runs',       authenticate, ctrl.getRuns);

module.exports = router;
