const router = require('express').Router();
const multer = require('multer');
const { body, param } = require('express-validator');
const { authenticate, authorize, requirePasswordAccess } = require('../middleware/auth');
const { importLimiter } = require('../middleware/rateLimiters');
const validate = require('../middleware/validate');
const c = require('../controllers/beijingAssetController');
const smartCtrl = require('../controllers/smartImportController');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

const IP_RE = /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;
const writeRoles = ['admin', 'asset_manager'];

router.get('/template', authenticate, authorize(...writeRoles), c.downloadTemplate);
router.get('/export',   authenticate, c.exportAssets);
router.get('/tag-stats', authenticate, c.tagStats);
router.get('/check-ip', authenticate, c.checkIp);

router.post(
  '/import',
  authenticate,
  authorize(...writeRoles),
  importLimiter,
  upload.single('file'),
  c.importAssets
);

router.post('/smart-import/preview', authenticate, authorize(...writeRoles), importLimiter,
  upload.single('file'), smartCtrl.makePreview('beijing_assets'));
router.post('/smart-import',         authenticate, authorize(...writeRoles), importLimiter,
  upload.single('file'), smartCtrl.makeApply('beijing_assets'));

const bulk = require('../controllers/bulkActionsController')(require('../services/beijingAssetService'), 'beijing_asset');
router.post('/bulk-update', authenticate, authorize(...writeRoles), bulk.bulkUpdate);
router.post('/bulk-delete', authenticate, authorize('admin'), bulk.bulkRemove);

router.get('/', authenticate, c.list);
router.get('/:id', authenticate, param('id').isUUID(), validate, c.get);
router.get('/:id/password', authenticate, requirePasswordAccess, param('id').isUUID(), validate, c.viewPassword);

const bodyValidators = [
  body('vmName').optional().isString().isLength({ min: 1, max: 255 }),
  body('vm_name').optional().isString().isLength({ min: 1, max: 255 }),
  body('ipAddress').optional().matches(IP_RE).withMessage('Invalid IP address'),
  body('ip_address').optional().matches(IP_RE).withMessage('Invalid IP address'),
];

router.post(
  '/',
  authenticate,
  authorize(...writeRoles),
  // The Add form posts camelCase (vmName/ipAddress); discovery "Add to
  // Inventory" and CSV import post snake_case. Accept either.
  body().custom(b => {
    const v = b.vmName ?? b.vm_name;
    if (typeof v !== 'string' || !v.trim()) throw new Error('vmName required');
    return true;
  }),
  body().custom(b => {
    const ip = b.ipAddress ?? b.ip_address;
    if (!ip) throw new Error('ipAddress required');
    if (!IP_RE.test(String(ip))) throw new Error('Invalid IP address');
    return true;
  }),
  validate,
  c.create
);

router.put(
  '/:id',
  authenticate,
  authorize(...writeRoles),
  param('id').isUUID(),
  ...bodyValidators,
  validate,
  c.update
);

router.delete(
  '/:id',
  authenticate,
  authorize('admin'),
  param('id').isUUID(),
  validate,
  c.remove
);

module.exports = router;
