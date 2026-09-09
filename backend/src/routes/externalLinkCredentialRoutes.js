const router = require('express').Router();
const ctrl   = require('../controllers/externalLinkCredentialController');

router.get('/:linkKey',    ctrl.get);
router.put('/:linkKey',    ctrl.save);
router.delete('/:linkKey', ctrl.remove);

module.exports = router;
