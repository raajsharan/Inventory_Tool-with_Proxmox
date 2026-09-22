const router = require('express').Router();
const multer = require('multer');
const { authorize } = require('../middleware/auth');
const ctrl = require('../controllers/agentPushController');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 200 * 1024 * 1024 } });
const adminGuard = authorize('admin', 'superadmin');

router.get('/assets',                       ctrl.listAssets);

router.get('/locations',                    ctrl.listLocations);
router.post('/locations',                   adminGuard, ctrl.createLocation);
router.delete('/locations/:id',             adminGuard, ctrl.deleteLocation);
router.post('/locations/:id/packages',      adminGuard, upload.array('files', 10), ctrl.uploadPackage);
router.post('/response-iss',                adminGuard, upload.single('file'), (req, res, next) => {
  req.files = req.file ? [req.file] : [];
  ctrl.uploadResponseIss(req, res, next);
});

router.post('/jobs',                        ctrl.createJob);
router.get('/jobs',                         ctrl.listJobs);
router.get('/jobs/:id',                     ctrl.getJob);
router.get('/jobs/:id/status',              ctrl.getJobStatus);

module.exports = router;
