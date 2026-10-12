const router = require('express').Router();
const { authorize, requirePageAccess } = require('../middleware/auth');
const c = require('../controllers/hostnamePatternConfigController');

// Read is open by default (same pattern as /compliance-config) — every
// Assets/Beijing Assets/Ext. Assets/Physical & ESXi Servers form needs this
// to render the Suggested Hostname panel, not just Dropdown Master's admins.
router.get('/', requirePageAccess('admin/dropdowns'), c.getConfig);
router.put('/', requirePageAccess('admin/dropdowns'), authorize('admin', 'superadmin'), c.saveConfig);

module.exports = router;
