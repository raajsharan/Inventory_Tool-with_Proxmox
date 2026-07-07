const router = require('express').Router();
const multer = require('multer');
const { authenticate, authorize } = require('../middleware/auth');
const ctrl = require('../controllers/vmwareController');

const adminRoles = ['admin', 'superadmin'];
const writeRoles = ['admin', 'superadmin', 'asset_manager'];

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

// Hosts / credentials (admin only)
router.get('/hosts',              authenticate, ctrl.listHosts);
router.post('/hosts',             authenticate, authorize(...adminRoles), ctrl.addHost);
router.put('/hosts/:id',          authenticate, authorize(...adminRoles), ctrl.updateHost);
router.delete('/hosts/:id',       authenticate, authorize(...adminRoles), ctrl.deleteHost);
router.post('/hosts/:id/test',    authenticate, authorize(...adminRoles), ctrl.testHost);
router.post('/hosts/:id/run',     authenticate, authorize(...adminRoles), ctrl.runDiscovery);

// On-demand discovery with credentials (admin)
router.post('/discover',          authenticate, authorize(...adminRoles), ctrl.runDiscoverySync);

// VM data (all authenticated users)
router.get('/vms',                authenticate, ctrl.listVMs);
router.get('/vms/export',         authenticate, ctrl.exportCSV);
router.get('/dashboard',          authenticate, ctrl.getDashboard);
router.get('/drift',              authenticate, ctrl.getDrift);
router.get('/esxi-topology',      authenticate, ctrl.getESXiTopology);
router.get('/reconcile',          authenticate, ctrl.getReconciliation);
router.get('/stale',              authenticate, ctrl.getStaleVMs);
router.get('/snapshots',          authenticate, ctrl.getSnapshots);
router.get('/runs',               authenticate, ctrl.getRunHistory);

// MAC Lookup
router.get('/mac-lookup',                    authenticate, ctrl.getMacLookup);
router.get('/mac-lookup/export',             authenticate, ctrl.exportMacLookupCSV);
router.get('/mac-lookup/files',              authenticate, ctrl.listMacFiles);
router.post('/mac-lookup/files',             authenticate, authorize(...adminRoles), upload.single('file'), ctrl.uploadMacFile);
router.delete('/mac-lookup/files/:id',       authenticate, authorize(...adminRoles), ctrl.deleteMacFile);
router.delete('/mac-lookup/files',           authenticate, authorize(...adminRoles), ctrl.clearMacFiles);

// Asset Editor
router.get('/asset-editor',                  authenticate, ctrl.getAssetEditor);
router.get('/asset-editor/export',           authenticate, ctrl.exportAssetEditorCSV);
router.post('/asset-editor/save',            authenticate, authorize(...adminRoles), ctrl.saveAssetEdit);
router.post('/asset-editor/reset',           authenticate, authorize(...adminRoles), ctrl.resetAssetEdit);

module.exports = router;
