const router = require('express').Router();
const { authorize } = require('../middleware/auth');
const ctrl = require('../controllers/migrationController');

// ── Projects list (for tracker project selector) ─────────────────────────────
router.get('/projects',        ctrl.listProjects);
router.get('/tab-config',      ctrl.getTabConfig);
router.get('/custom-tabs',          ctrl.listCustomTabs);
router.get('/field-definitions',    ctrl.getFieldDefs);
router.get('/field-values',         ctrl.getFieldValues);
router.put('/field-values', authorize('admin', 'asset_manager', 'superadmin'), ctrl.setFieldValue);
router.get('/custom-vms',             ctrl.listCustomVMs);
router.get('/custom-vms/summary',     ctrl.customVMSummary);
router.get('/custom-vms/filter-opts', ctrl.customFilterOptions);
router.patch('/custom-vms/:id',  authorize('admin', 'asset_manager'), ctrl.patchCustomVM);
router.delete('/custom-vms/:id', authorize('admin', 'asset_manager'), ctrl.deleteCustomVM);

// ── Overview ─────────────────────────────────────────────────────────────────
router.get('/overview', ctrl.overview);

// ── Hosts ─────────────────────────────────────────────────────────────────────
// Note: static paths must come before /:id routes to avoid param capture
router.get('/hosts',                     ctrl.listHosts);
router.get('/hosts/summary',             ctrl.hostsSummary);
router.get('/hosts/:id/credentials',     ctrl.getHostCredentials);
router.patch('/hosts/:id',               authorize('admin', 'asset_manager'), ctrl.patchHost);
router.delete('/hosts/:id',              authorize('admin', 'asset_manager'), ctrl.deleteHost);

// ── Bomgar VMs ────────────────────────────────────────────────────────────────
router.get('/bomgar-vms',                ctrl.listBomgar);
router.get('/bomgar-vms/summary',        ctrl.bomgarSummary);
router.patch('/bomgar-vms/:id',          authorize('admin', 'asset_manager'), ctrl.patchBomgar);
router.delete('/bomgar-vms/:id',         authorize('admin', 'asset_manager'), ctrl.deleteBomgar);

// ── Security VMs ──────────────────────────────────────────────────────────────
router.get('/security-vms',              ctrl.listSecurity);
router.get('/security-vms/summary',      ctrl.securitySummary);
router.patch('/security-vms/:id',        authorize('admin', 'asset_manager'), ctrl.patchSecurity);
router.delete('/security-vms/:id',       authorize('admin', 'asset_manager'), ctrl.deleteSecurity);

// ── Standalone ESXi ───────────────────────────────────────────────────────────
router.get('/standalone-esxi',           ctrl.listStandalone);
router.get('/standalone-esxi/summary',   ctrl.standaloneSummary);
router.patch('/standalone-esxi/:id',     authorize('admin', 'asset_manager'), ctrl.patchStandalone);
router.delete('/standalone-esxi/:id',    authorize('admin', 'asset_manager'), ctrl.deleteStandalone);

// ── Shared ────────────────────────────────────────────────────────────────────
router.get('/filter-options/:type',  ctrl.filterOptions);
router.get('/export/:type',          ctrl.csvExport);

// ── Template download ─────────────────────────────────────────────────────────
router.get('/template', ctrl.downloadTemplate);

// ── Import (admin only) ───────────────────────────────────────────────────────
router.post('/import/preview', authorize('admin', 'asset_manager'), ctrl.importPreview);
router.post('/import/confirm', authorize('admin', 'asset_manager'), ctrl.importConfirm);

module.exports = router;
