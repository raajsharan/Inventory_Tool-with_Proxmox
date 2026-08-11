const router = require('express').Router();
const multer = require('multer');
const { authenticate, authorize, requirePageAccess } = require('../middleware/auth');
const ctrl = require('../controllers/vmwareController');

const adminRoles = ['admin', 'superadmin'];
const writeRoles = ['admin', 'superadmin', 'asset_manager'];

const guard      = [authenticate, requirePageAccess('vmware')];
const adminGuard = [authenticate, requirePageAccess('vmware'), authorize(...adminRoles)];
const writeGuard = [authenticate, requirePageAccess('vmware'), authorize(...writeRoles)];

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

// Hosts / credentials (admin only)
router.get('/hosts',              ...guard,      ctrl.listHosts);
router.post('/hosts',             ...adminGuard, ctrl.addHost);
router.put('/hosts/:id',          ...adminGuard, ctrl.updateHost);
router.delete('/hosts/:id',       ...adminGuard, ctrl.deleteHost);
router.post('/hosts/:id/test',    ...adminGuard, ctrl.testHost);
router.post('/hosts/:id/run',     ...adminGuard, ctrl.runDiscovery);

// On-demand discovery with credentials (admin)
router.post('/discover',          ...adminGuard, ctrl.runDiscoverySync);

// VM data (all authenticated users)
router.get('/vms',                ...guard, ctrl.listVMs);
router.get('/vms/export',         ...guard, ctrl.exportCSV);
router.get('/dashboard',          ...guard, ctrl.getDashboard);
router.get('/drift',              ...guard, ctrl.getDrift);
router.get('/drift/history',      ...guard, ctrl.getDriftHistory);
router.get('/esxi-topology',      ...guard, ctrl.getESXiTopology);
router.get('/reconcile',          ...guard, ctrl.getReconciliation);
router.get('/stale',              ...guard, ctrl.getStaleVMs);
router.get('/snapshots',          ...guard, ctrl.getSnapshots);
router.get('/runs',               ...guard, ctrl.getRunHistory);

// MAC Lookup
router.get('/mac-lookup',                    ...guard, ctrl.getMacLookup);
router.get('/mac-lookup/export',             ...guard, ctrl.exportMacLookupCSV);
router.get('/mac-lookup/files',              ...guard, ctrl.listMacFiles);
router.post('/mac-lookup/files',             ...writeGuard, upload.single('file'), ctrl.uploadMacFile);
router.delete('/mac-lookup/files/:id',       ...writeGuard, ctrl.deleteMacFile);
router.delete('/mac-lookup/files',           ...writeGuard, ctrl.clearMacFiles);

// Asset Editor
router.get('/asset-editor',                  ...guard, ctrl.getAssetEditor);
router.get('/asset-editor/export',           ...guard, ctrl.exportAssetEditorCSV);
router.post('/asset-editor/save',            ...writeGuard, ctrl.saveAssetEdit);
router.post('/asset-editor/reset',           ...writeGuard, ctrl.resetAssetEdit);

module.exports = router;
