const router = require('express').Router();
const multer = require('multer');
const { authorize } = require('../middleware/auth');
const ctrl = require('../controllers/backupController');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 500 * 1024 * 1024 } });
const adminOnly = authorize('admin');

router.get('/settings/:kind',  adminOnly, ctrl.getSettings);
router.put('/settings/:kind',  adminOnly, ctrl.updateSettings);
router.get('/runs/:kind',      adminOnly, ctrl.listRuns);
router.post('/pg/run',         adminOnly, ctrl.runPgNow);
router.post('/csv/run',        adminOnly, ctrl.runCsvNow);
router.post('/pg/restore',     adminOnly, upload.single('file'), ctrl.restoreDump);

router.get('/csv/files',        adminOnly, ctrl.listCsvFiles);
router.post('/csv/restore',     adminOnly, ctrl.restoreCsvFromHistory);
router.post('/csv/restore-upload', adminOnly, upload.single('file'), ctrl.restoreCsvUpload);

module.exports = router;
