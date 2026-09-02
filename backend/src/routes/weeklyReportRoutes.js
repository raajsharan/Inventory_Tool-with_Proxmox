const router = require('express').Router();
const { authenticate, authorize, requirePageAccess } = require('../middleware/auth');
const ctrl = require('../controllers/weeklyReportController');

const viewGuard  = [authenticate, requirePageAccess('weekly_report')];
const adminGuard = [authenticate, requirePageAccess('weekly_report'), authorize('admin', 'superadmin')];
const inputGuard = [authenticate, requirePageAccess('admin/weekly-report-inputs')];
const inputWriteGuard = [authenticate, requirePageAccess('admin/weekly-report-inputs'), authorize('admin', 'asset_manager')];

router.get('/current',            ...viewGuard,  ctrl.getCurrent);
router.get('/snapshots',          ...viewGuard,  ctrl.listSnapshots);
router.get('/snapshots/:id',      ...viewGuard,  ctrl.getSnapshot);
router.post('/generate-now',      ...adminGuard, ctrl.generateNow);

router.get('/manual-sections',            ...inputGuard,      ctrl.listManualSections);
router.put('/manual-sections/:sectionKey', ...inputWriteGuard, ctrl.updateManualSection);

module.exports = router;
