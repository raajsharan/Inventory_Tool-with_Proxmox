const router   = require('express').Router();
const { authenticate, authorize } = require('../middleware/auth');
const ctrl     = require('../controllers/userPageAccessController');

const adminRoles = ['admin', 'superadmin'];

router.get('/',           authenticate, authorize(...adminRoles), ctrl.listUsers);
router.get('/my-access',  authenticate,                          ctrl.getMyAccess);
router.put('/:userId',    authenticate, authorize(...adminRoles), ctrl.saveAccess);

module.exports = router;
