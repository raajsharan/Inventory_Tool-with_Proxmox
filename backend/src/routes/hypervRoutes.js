const router = require('express').Router();
const { authenticate, authorize, requirePageAccess } = require('../middleware/auth');
const ctrl = require('../controllers/hypervController');

const guard = [authenticate, requirePageAccess('hyperv')];
const admin = authorize('admin', 'superadmin');

router.get('/hosts',              ...guard, ctrl.listHosts);
router.post('/hosts',             ...guard, admin, ctrl.addHost);
router.put('/hosts/:id',          ...guard, admin, ctrl.updateHost);
router.delete('/hosts/:id',       ...guard, admin, ctrl.removeHost);
router.post('/hosts/:id/test',    ...guard, admin, ctrl.testHost);
router.post('/hosts/:id/run',     ...guard, admin, ctrl.triggerRun);

router.get('/vms',        ...guard, ctrl.listVMs);
router.get('/dashboard',  ...guard, ctrl.getDashboard);
router.get('/drift',          ...guard, ctrl.getDrift);
router.get('/drift/history',  ...guard, ctrl.getDriftHistory);
router.get('/drift/activity', ...guard, ctrl.getDriftActivity);
router.get('/stale',      ...guard, ctrl.getStale);
router.get('/snapshots',  ...guard, ctrl.getSnapshots);
router.get('/mac-lookup',        ...guard, ctrl.getMacLookup);
router.get('/mac-lookup/export', ...guard, ctrl.exportMacLookupCSV);
router.get('/runs',       ...guard, ctrl.getRuns);

module.exports = router;
