const router = require('express').Router();
const { authenticate, authorize } = require('../middleware/auth');
const c = require('../controllers/inventoryFieldsController');

router.get('/:pageKey', authenticate, c.get);
router.put('/:pageKey', authenticate, authorize('admin'), c.bulkUpdateOverrides);
router.post('/:pageKey/extras', authenticate, authorize('admin'), c.createExtra);
router.put('/:pageKey/extras/:fieldKey', authenticate, authorize('admin'), c.updateExtra);
router.delete('/:pageKey/extras/:fieldKey', authenticate, authorize('admin'), c.deleteExtra);
router.delete('/:pageKey/:fieldKey', authenticate, authorize('admin'), c.resetField);

module.exports = router;
