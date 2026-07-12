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
router.use('/inventory-fields', authenticate,                                                require('./inventoryFieldsRoutes'));
router.use('/backup',           authenticate, requirePageAccess('admin/backup'),            require('./backupRoutes'));
router.use('/branding',         require('./brandingRoutes'));
router.use('/recycle-bin',      authenticate, requirePageAccess('admin/recycle-bin'),     require('./recycleBinRoutes'));
router.use('/vmware',              require('./vmwareRoutes'));
router.use('/proxmox',             require('./proxmoxRoutes'));
router.use('/user-page-control',   authenticate, require('./userPageAccessRoutes'));
router.use('/roles',               require('./customRolesRoutes'));
router.use('/software-status',     require('./softwareStatusRoutes'));
router.use('/nessus-status',       require('./nessusStatusRoutes'));
router.use('/tenable',             require('./tenableRoutes'));
router.use('/db-import',           authenticate, requirePageAccess('admin/imports'), require('./dbImportRoutes'));
router.use('/search',              require('./searchRoutes'));
router.use('/data-health',         require('./dataHealthRoutes'));
router.use('/decommissioned',      authenticate, requirePageAccess('decommissioned'), require('./decommissionRoutes'));
router.use('/compliance-config',   authenticate, require('./complianceConfigRoutes'));
router.use('/admin/migration-projects', authenticate, require('./migrationProjectRoutes'));
router.use('/migration',                authenticate, requirePageAccess('migration_tracker'), require('./migrationRoutes'));
router.use('/endpoint-central',         authenticate, requirePageAccess('endpoint_central'),   require('./endpointCentralRoutes'));

module.exports = router;
