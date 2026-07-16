const router = require('express').Router();
const multer = require('multer');
const { body, param } = require('express-validator');
const { authenticate, authorize, requirePasswordAccess } = require('../middleware/auth');
const validate = require('../middleware/validate');
const c = require('../controllers/extAssetController');
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
  upload.single('file'),
  c.importAssets
);

router.post('/smart-import/preview', authenticate, authorize(...writeRoles),
  upload.single('file'), smartCtrl.makePreview('ext_assets'));
router.post('/smart-import',         authenticate, authorize(...writeRoles),
  upload.single('file'), smartCtrl.makeApply('ext_assets'));

const bulk = require('../controllers/bulkActionsController')(require('../services/extAssetService'), 'ext_asset');
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

// Some callers (e.g. AddToInventoryModal from VMware/Proxmox discovery) post
// snake_case field names. Normalize them to the camelCase names the
// validators below (and the rest of the create pipeline) expect.
function acceptSnakeCaseAliases(req, _res, next) {
  if (req.body) {
    if (req.body.vmName === undefined && req.body.vm_name !== undefined) {
      req.body.vmName = req.body.vm_name;
    }
    if (req.body.ipAddress === undefined && req.body.ip_address !== undefined) {
      req.body.ipAddress = req.body.ip_address;
    }
  }
  next();
}

router.post(
  '/',
  authenticate,
  authorize(...writeRoles),
  acceptSnakeCaseAliases,
  body('vmName').exists().withMessage('vmName required').bail().isString(),
  body('ipAddress').exists().withMessage('ipAddress required').bail().matches(IP_RE).withMessage('Invalid IP address'),
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
