const router = require('express').Router();
const { authorize } = require('../middleware/auth');
const ctrl = require('../controllers/recycleBinController');

// Admin or superadmin can list and restore. Only superadmin can purge.
const adminOrAbove = authorize('admin');

router.get('/',                    adminOrAbove, ctrl.list);
router.post('/:type/:id/restore',  adminOrAbove, ctrl.restore);
router.delete('/:type/:id',        adminOrAbove, ctrl.purge);     // additional super-only check inside
router.post('/empty',              adminOrAbove, ctrl.emptyAll);  // additional super-only check inside

module.exports = router;
