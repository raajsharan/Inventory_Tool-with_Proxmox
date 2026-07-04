const router = require('express').Router();
const ctrl   = require('../controllers/dbImportController');

router.post('/test',    ctrl.testConnection);
router.post('/columns', ctrl.fetchColumns);
router.post('/preview', ctrl.preview);
router.post('/apply',   ctrl.apply);

module.exports = router;
