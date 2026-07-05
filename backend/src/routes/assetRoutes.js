const router = require('express').Router();
const multer = require('multer');
const { body, param } = require('express-validator');
const { authenticate, authorize, requirePasswordAccess } = require('../middleware/auth');
const validate = require('../middleware/validate');
const assetCtrl = require('../controllers/assetController');
const importCtrl = require('../controllers/importController');
const smartCtrl = require('../controllers/smartImportController');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

const IP_RE = /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;

const writeRoles = ['admin', 'asset_manager'];

router.get('/template', authenticate, authorize(...writeRoles), importCtrl.downloadTemplate);
router.get('/export',   authenticate, importCtrl.exportAssets);
router.get('/tag-stats', authenticate, assetCtrl.tagStats);
router.get('/check-ip', authenticate, assetCtrl.checkIp);

router.post(
  '/import',
  authenticate,
  authorize(...writeRoles),
  upload.single('file'),
  importCtrl.importAssets
);

router.post('/smart-import/preview', authenticate, authorize(...writeRoles),
  upload.single('file'), smartCtrl.makePreview('assets'));
router.post('/smart-import',         authenticate, authorize(...writeRoles),
  upload.single('file'), smartCtrl.makeApply('assets'));

router.get('/', authenticate, assetCtrl.list);
router.get('/:id', authenticate, param('id').isUUID(), validate, assetCtrl.get);
router.get('/:id/password', authenticate, requirePasswordAccess, param('id').isUUID(), validate, assetCtrl.viewPassword);

const assetBodyValidators = [
  body('vmName').optional().isString().isLength({ min: 1, max: 255 }),
  body('vm_name').optional().isString().isLength({ min: 1, max: 255 }),
  body('ipAddress').optional().matches(IP_RE).withMessage('Invalid IP address'),
  body('ip_address').optional().matches(IP_RE).withMessage('Invalid IP address'),
];

router.post(
  '/',
  authenticate,
  authorize(...writeRoles),
  body('vmName').exists().withMessage('vmName required').bail().isString(),
  body('ipAddress').exists().withMessage('ipAddress required').bail().matches(IP_RE).withMessage('Invalid IP address'),
  validate,
  assetCtrl.create
);

router.put(
  '/:id',
  authenticate,
  authorize(...writeRoles),
  param('id').isUUID(),
  ...assetBodyValidators,
  validate,
  assetCtrl.update
);

router.delete(
  '/:id',
  authenticate,
  authorize('admin'),
  param('id').isUUID(),
  validate,
  assetCtrl.remove
);

module.exports = router;
