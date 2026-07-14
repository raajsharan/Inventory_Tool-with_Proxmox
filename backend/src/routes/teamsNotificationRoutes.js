const router = require('express').Router();
const { authenticate, authorize } = require('../middleware/auth');
const ctrl   = require('../controllers/teamsNotificationController');

const adminGuard = [authenticate, authorize('admin', 'superadmin')];

router.get('/',      ...adminGuard, ctrl.getConfig);
router.put('/',      ...adminGuard, ctrl.saveConfig);
router.post('/test', ...adminGuard, ctrl.testNotification);

module.exports = router;
