const router = require('express').Router();
const { authenticate, authorize } = require('../middleware/auth');
const ctrl = require('../controllers/brandingController');

// Public read so login page / browser tab title can render before auth.
router.get('/', ctrl.getBranding);

// Admins/superadmin only.
router.put('/', authenticate, authorize('admin'), ctrl.updateBranding);

module.exports = router;
