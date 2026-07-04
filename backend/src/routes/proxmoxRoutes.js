const router = require('express').Router();
const ctrl   = require('../controllers/proxmoxController');
const { authenticate, authorize } = require('../middleware/auth');

const adminRoles = ['admin', 'superadmin'];

// Admin-only: host / credential management
router.get   ('/hosts',           authenticate, ctrl.listHosts);
router.post  ('/hosts',           authenticate, authorize(...adminRoles), ctrl.addHost);
router.put   ('/hosts/:id',       authenticate, authorize(...adminRoles), ctrl.updateHost);
router.delete('/hosts/:id',       authenticate, authorize(...adminRoles), ctrl.deleteHost);
router.post  ('/hosts/:id/test',  authenticate, authorize(...adminRoles), ctrl.testHost);
router.post  ('/hosts/:id/run',   authenticate, authorize(...adminRoles), ctrl.runDiscovery);
router.post  ('/discover',        authenticate, authorize(...adminRoles), ctrl.runDiscoverySync);

// All authenticated users: read data
router.get('/vms',           authenticate, ctrl.listVMs);
router.get('/vms/export',    authenticate, ctrl.exportCSV);
router.get('/dashboard',     authenticate, ctrl.getDashboard);
router.get('/drift',         authenticate, ctrl.getDrift);
router.get('/node-topology', authenticate, ctrl.getNodeTopology);
router.get('/stale',         authenticate, ctrl.getStaleVMs);
router.get('/snapshots',     authenticate, ctrl.getSnapshots);
router.get('/runs',          authenticate, ctrl.getRunHistory);

module.exports = router;
