const router   = require('express').Router();
const { authenticate, authorize, requirePageAccess } = require('../middleware/auth');
const ctrl     = require('../controllers/tenableController');

const guard      = [authenticate, requirePageAccess('tenable_report')];
const adminGuard = [authenticate, requirePageAccess('tenable_report'), authorize('admin', 'superadmin')];

router.get('/report',         ...guard,      ctrl.getReport);
router.get('/total-ips',      ...guard,      ctrl.getTotalIPs);
router.get('/imports',        ...adminGuard, ctrl.getImports);
router.post('/import',        ...adminGuard, ctrl.uploadMiddleware, ctrl.importFile);
router.delete('/imports/:id', ...adminGuard, ctrl.deleteImport);

module.exports = router;
