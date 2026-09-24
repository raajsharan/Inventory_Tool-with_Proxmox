const router = require('express').Router();
const { param } = require('express-validator');
const { authenticate, authorize, requirePageAccess } = require('../middleware/auth');
const validate = require('../middleware/validate');
const c = require('../controllers/customTopologyController');

const writeRoles = ['admin', 'asset_manager'];
// The mount in routes/index.js also admits Topology of Sites viewers, who may
// read these diagrams but must not change them — so every write keeps the
// builder's own page gate on top of the role check.
const builderOnly = requirePageAccess('admin/custom-topology');

router.get('/',    authenticate, c.list);
router.get('/:id', authenticate, param('id').isUUID(), validate, c.get);

router.post('/', authenticate, authorize(...writeRoles), builderOnly, c.create);

router.put(
  '/:id',
  authenticate,
  authorize(...writeRoles),
  builderOnly,
  param('id').isUUID(),
  validate,
  c.update
);

router.delete(
  '/:id',
  authenticate,
  authorize(...writeRoles),
  builderOnly,
  param('id').isUUID(),
  validate,
  c.remove
);

module.exports = router;
