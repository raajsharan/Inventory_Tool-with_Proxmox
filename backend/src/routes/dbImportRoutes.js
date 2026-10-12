const router = require('express').Router();
const { authorize } = require('../middleware/auth');
const ctrl   = require('../controllers/dbImportController');

// Mirrors importRoutes.js's role gate — this feature connects to an
// arbitrary external database with client-supplied credentials and writes
// the results straight into inventory tables, so it must never fall back to
// the page-access matrix's "open by default" behavior alone.
const writeRoles = authorize('admin', 'asset_manager');

router.post('/test',    writeRoles, ctrl.testConnection);
router.post('/columns', writeRoles, ctrl.fetchColumns);
router.post('/preview', writeRoles, ctrl.preview);
router.post('/apply',   writeRoles, ctrl.apply);

module.exports = router;
