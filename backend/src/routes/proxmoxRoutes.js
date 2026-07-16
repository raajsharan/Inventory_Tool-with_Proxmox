const router = require('express').Router();
const ctrl   = require('../controllers/proxmoxController');
const { authenticate, authorize, requirePageAccess } = require('../middleware/auth');

const adminRoles = ['admin', 'superadmin'];

const guard      = [authenticate, requirePageAccess('proxmox')];
const adminGuard = [authenticate, requirePageAccess('proxmox'), authorize(...adminRoles)];

// Admin-only: host / credential management
router.get   ('/hosts',           ...guard,      ctrl.listHosts);
router.post  ('/hosts',           ...adminGuard, ctrl.addHost);
router.put   ('/hosts/:id',       ...adminGuard, ctrl.updateHost);
router.delete('/hosts/:id',       ...adminGuard, ctrl.deleteHost);
router.post  ('/hosts/:id/test',  ...adminGuard, ctrl.testHost);
router.post  ('/hosts/:id/run',   ...adminGuard, ctrl.runDiscovery);
router.post  ('/discover',        ...adminGuard, ctrl.runDiscoverySync);

// All authenticated users: read data
router.get('/vms',           ...guard, ctrl.listVMs);
router.get('/vms/export',    ...guard, ctrl.exportCSV);
router.get('/dashboard',     ...guard, ctrl.getDashboard);
router.get('/drift',         ...guard, ctrl.getDrift);
router.get('/node-topology', ...guard, ctrl.getNodeTopology);
router.get('/stale',         ...guard, ctrl.getStaleVMs);
router.get('/snapshots',     ...guard, ctrl.getSnapshots);
router.get('/runs',          ...guard, ctrl.getRunHistory);

module.exports = router;
