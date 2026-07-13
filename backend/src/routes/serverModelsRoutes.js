const router = require('express').Router();
const { authorize } = require('../middleware/auth');
const ctrl = require('../controllers/serverModelsController');

// Any authenticated user may read (used to populate form dropdowns).
router.get('/', ctrl.list);

// Write operations require admin / superadmin.
router.post('/',    authorize('admin', 'superadmin'), ctrl.create);
router.put('/:id',  authorize('admin', 'superadmin'), ctrl.update);
router.delete('/:id', authorize('admin', 'superadmin'), ctrl.remove);

module.exports = router;
