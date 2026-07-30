const router = require('express').Router();
const { authenticate } = require('../middleware/auth');
const ctrl = require('../controllers/alertsController');

// Any authenticated user can see the alert bell — it summarizes discovery
// health across integrations they may or may not individually administer.
router.get('/', authenticate, ctrl.getAlerts);

module.exports = router;
