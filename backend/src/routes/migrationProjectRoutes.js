const router = require('express').Router();
const { authorize } = require('../middleware/auth');
const ctrl = require('../controllers/migrationProjectController');

router.get('/',      ctrl.listProjects);
router.post('/',     authorize('admin', 'superadmin'), ctrl.createProject);
router.patch('/:id', authorize('admin', 'superadmin'), ctrl.updateProject);
router.delete('/:id', authorize('admin', 'superadmin'), ctrl.deleteProject);

// Danger zone: permanently wipe a built-in VM tab's data across ALL projects.
router.delete('/danger/wipe/:tabKey', authorize('admin', 'superadmin'), ctrl.wipeTabData);
router.get('/:id/tab-config',                        ctrl.getTabConfig);
router.put('/:id/tab-config', authorize('admin', 'superadmin'), ctrl.saveTabConfig);
router.get('/:id/custom-tabs',                       ctrl.listCustomTabs);
router.post('/:id/custom-tabs', authorize('admin', 'superadmin'), ctrl.createCustomTab);
router.patch('/:id/custom-tabs/:tabId', authorize('admin', 'superadmin'), ctrl.updateCustomTab);
router.delete('/:id/custom-tabs/:tabId', authorize('admin', 'superadmin'), ctrl.deleteCustomTab);

router.get('/:id/field-definitions',                        ctrl.listFieldDefs);
router.post('/:id/field-definitions', authorize('admin', 'superadmin'), ctrl.createFieldDef);
router.patch('/:id/field-definitions/:defId', authorize('admin', 'superadmin'), ctrl.updateFieldDef);
router.delete('/:id/field-definitions/:defId', authorize('admin', 'superadmin'), ctrl.deleteFieldDef);

module.exports = router;
