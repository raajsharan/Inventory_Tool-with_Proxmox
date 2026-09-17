const router = require('express').Router();
const { param } = require('express-validator');
const { authenticate, authorize } = require('../middleware/auth');
const validate = require('../middleware/validate');
const c = require('../controllers/customTopologyController');

const writeRoles = ['admin', 'asset_manager'];

router.get('/',    authenticate, c.list);
router.get('/:id', authenticate, param('id').isUUID(), validate, c.get);

router.post('/', authenticate, authorize(...writeRoles), c.create);

router.put(
  '/:id',
  authenticate,
  authorize(...writeRoles),
  param('id').isUUID(),
  validate,
  c.update
);

router.delete(
  '/:id',
  authenticate,
  authorize(...writeRoles),
  param('id').isUUID(),
  validate,
  c.remove
);

module.exports = router;
