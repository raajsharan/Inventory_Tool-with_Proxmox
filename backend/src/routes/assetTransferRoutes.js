const router = require('express').Router();
const { authorize } = require('../middleware/auth');
const ctrl = require('../controllers/assetTransferController');

// Admin-only — moves records between inventories, which is a destructive
// operation on the source side (soft-delete) even though recoverable.
const adminOnly = authorize('admin');

router.get('/inventories',  adminOnly, ctrl.listInventories);
router.post('/preview',     adminOnly, ctrl.preview);
router.post('/transfer',    adminOnly, ctrl.transfer);

module.exports = router;
