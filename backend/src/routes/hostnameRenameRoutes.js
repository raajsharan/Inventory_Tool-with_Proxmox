const router = require('express').Router();
const { authenticate, requireAgentManageAccess } = require('../middleware/auth');
const ctrl = require('../controllers/hostnameRenameController');

// Same gate as agent install/reinstall (Nessus/ManageEngine) — a remote,
// credentialed, privileged action against a live server, not tied to any one
// inventory page's own access, so it's gated on this capability alone
// rather than stacking a requirePageAccess check per source table.
router.post('/', authenticate, requireAgentManageAccess, ctrl.rename);

module.exports = router;
