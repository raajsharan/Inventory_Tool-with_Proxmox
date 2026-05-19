const router = require('express').Router();
const { authenticate, authorize } = require('../middleware/auth');
const c = require('../controllers/builtinPagesController');

router.get('/', authenticate, c.list);
router.put('/:pageKey', authenticate, authorize('admin'), c.update);
router.delete('/:pageKey', authenticate, authorize('admin'), c.reset);

module.exports = router;
