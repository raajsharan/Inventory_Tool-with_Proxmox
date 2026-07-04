const router = require('express').Router();
const { authenticate, authorize } = require('../middleware/auth');
const ctrl = require('../controllers/customRolesController');

const adminRoles = ['admin', 'superadmin'];

router.get('/',                authenticate,                          ctrl.list);
router.get('/options',         authenticate,                          ctrl.listOptions);
router.put('/system/:name',    authenticate, authorize(...adminRoles), ctrl.updateSystem);
router.post('/',               authenticate, authorize(...adminRoles), ctrl.create);
router.put('/:id',             authenticate, authorize(...adminRoles), ctrl.update);
router.delete('/:id',          authenticate, authorize(...adminRoles), ctrl.remove);

module.exports = router;
