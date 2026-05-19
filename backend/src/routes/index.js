const router = require('express').Router();
const { authenticate, requirePageAccess } = require('../middleware/auth');

router.use('/auth',             require('./authRoutes'));
router.use('/dashboard',        authenticate, requirePageAccess('dashboard'),              require('./dashboardRoutes'));

router.use('/assets',           authenticate, requirePageAccess('assets'),                 require('./assetRoutes'));
router.use('/beijing-assets',   authenticate, requirePageAccess('beijing_assets'),         require('./beijingAssetRoutes'));
router.use('/ext-assets',       authenticate, requirePageAccess('ext_assets'),             require('./extAssetRoutes'));
router.use('/physical-esxi',    authenticate, requirePageAccess('physical_esxi_servers'),  require('./physicalEsxiRoutes'));

router.use('/dropdowns',        authenticate, requirePageAccess('admin/dropdowns'),        require('./dropdownRoutes'));
router.use('/departments',      authenticate, requirePageAccess('admin/tag-ranges'),       require('./departmentRoutes'));
router.use('/users',            authenticate, requirePageAccess('admin/users'),            require('./userRoutes'));
router.use('/custom-pages',     require('./customPageRoutes'));
router.use('/audit',            authenticate, requirePageAccess('admin/audit'),            require('./auditRoutes'));
router.use('/imports',          authenticate, requirePageAccess('admin/imports'),          require('./importRoutes'));
router.use('/reports',          authenticate, requirePageAccess('reports'),                require('./reportRoutes'));
router.use('/field-visibility', authenticate, requirePageAccess('admin/field-visibility'), require('./fieldVisibilityRoutes'));
router.use('/page-access',      authenticate, requirePageAccess('admin/page-access'),      require('./pageAccessRoutes'));
router.use('/builtin-pages',    authenticate,                                                require('./builtinPagesRoutes'));

module.exports = router;
