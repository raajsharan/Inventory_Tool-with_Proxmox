const router = require('express').Router();
const { authenticate, authorize, requirePageAccess } = require('../middleware/auth');
const ctrl = require('../controllers/weeklyReportController');

const viewGuard  = [authenticate, requirePageAccess('weekly_report')];
const adminGuard = [authenticate, requirePageAccess('weekly_report'), authorize('admin', 'superadmin')];
// Snapshot deletion + schedule config are managed from their own Admin page
// (Admin/WeeklyReportAdmin.jsx), gated by that page's own access key rather
// than the report-viewing one above.
const configGuard = [authenticate, requirePageAccess('admin/weekly-report-config'), authorize('admin', 'superadmin')];

router.get('/current',            ...viewGuard,  ctrl.getCurrent);
router.get('/snapshots',          ...viewGuard,  ctrl.listSnapshots);
router.get('/snapshots/:id',      ...viewGuard,  ctrl.getSnapshot);
router.post('/generate-now',      ...adminGuard, ctrl.generateNow);
router.delete('/snapshots/:id',   ...configGuard, ctrl.deleteSnapshot);

router.get('/schedule', ...configGuard, ctrl.getSchedule);
router.put('/schedule', ...configGuard, ctrl.saveSchedule);

// The Inputs editor lives inside the Weekly Report page itself (a tab, not a
// separate page) — anyone who can see the report can also edit the manual
// sections, same as any other collaboratively-maintained content in here.
router.get('/manual-sections',            ...viewGuard, ctrl.listManualSections);
router.post('/manual-sections',            ...viewGuard, ctrl.createManualSection);
router.put('/manual-sections/:sectionKey', ...viewGuard, ctrl.updateManualSection);
router.delete('/manual-sections/:sectionKey', ...viewGuard, ctrl.deleteManualSection);

module.exports = router;
