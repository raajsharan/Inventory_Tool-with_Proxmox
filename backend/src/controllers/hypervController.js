const db      = require('../services/hypervDbService');
const svc     = require('../services/hypervService');

// ── Hosts ─────────────────────────────────────────────────────────────────────

async function listHosts(req, res, next) {
  try { res.json(await db.listHosts()); } catch (e) { next(e); }
}

async function addHost(req, res, next) {
  try {
    const host = await db.upsertHost(req.body);
    if (req.body.runNow) runDiscovery(host.id).catch(() => {});
    res.status(201).json(host);
  } catch (e) { next(e); }
}

async function updateHost(req, res, next) {
  try {
    const host = await db.updateHostById(parseInt(req.params.id, 10), req.body);
    if (!host) return res.status(404).json({ error: 'Not found' });
    res.json(host);
  } catch (e) { next(e); }
}

async function removeHost(req, res, next) {
  try {
    const ok = await db.deleteHost(parseInt(req.params.id, 10));
    if (!ok) return res.status(404).json({ error: 'Not found' });
    res.status(204).end();
  } catch (e) { next(e); }
}

async function testHost(req, res, next) {
  try {
    const id = parseInt(req.params.id, 10);
    let cfg;
    if (id === 0) {
      cfg = { ...req.body, password: req.body.password };
    } else {
      const h = await db.getHostById(id);
      if (!h) return res.status(404).json({ error: 'Not found' });
      cfg = { host: h.host, username: h.username, password: db.getDecryptedPassword(h), port: h.port, useSSL: h.use_ssl, verifySSL: h.verify_ssl };
    }
    const result = await svc.testConnection(cfg);
    res.json(result);
  } catch (e) { next(e); }
}

async function triggerRun(req, res, next) {
  try {
    const id = parseInt(req.params.id, 10);
    runDiscovery(id).catch(() => {});
    res.json({ started: true });
  } catch (e) { next(e); }
}

// ── Discovery run (background) ────────────────────────────────────────────────

async function runDiscovery(hostId) {
  const h = await db.getHostById(hostId);
  if (!h || h.is_running) return;

  await db.setHostRunning(hostId, true);
  const runId = await db.startRun(hostId, h.host);
  try {
    const cfg = {
      host:      h.host,
      username:  h.username,
      password:  db.getDecryptedPassword(h),
      port:      h.port,
      useSSL:    h.use_ssl,
      verifySSL: h.verify_ssl,
    };
    const vms = await svc.discoverVMs(cfg);
    await db.saveVMs(runId, hostId, h.host, vms);
    await db.finishRun(runId, vms.length);
    await db.setLastDiscovery(hostId, vms.length);
  } catch (e) {
    await db.failRun(runId, e.message);
    await db.setHostRunning(hostId, false);
  }
}

// ── Data endpoints ─────────────────────────────────────────────────────────────

async function listVMs(req, res, next) {
  try {
    const hostId = req.query.host_id ? parseInt(req.query.host_id, 10) : null;
    let vms = await db.getLatestVMs(hostId);

    const { search, state, os_type } = req.query;
    if (search) {
      const q = search.toLowerCase();
      vms = vms.filter(v => (v.name || '').toLowerCase().includes(q) || (v.source_host || '').toLowerCase().includes(q));
    }
    if (state)   vms = vms.filter(v => (v.state   || '').toLowerCase() === state.toLowerCase());
    if (os_type) vms = vms.filter(v => (v.os_type || '').toLowerCase() === os_type.toLowerCase());

    res.json({ items: vms, total: vms.length });
  } catch (e) { next(e); }
}

async function getDashboard(req, res, next) {
  try { res.json(await db.getDashboardStats()); } catch (e) { next(e); }
}

async function getDrift(req, res, next) {
  try { res.json(await db.getDrift()); } catch (e) { next(e); }
}

async function getStale(req, res, next) {
  try { res.json(await db.getStaleVMs()); } catch (e) { next(e); }
}

async function getSnapshots(req, res, next) {
  try { res.json(await db.getSnapshotVMs()); } catch (e) { next(e); }
}

async function getRuns(req, res, next) {
  try {
    const hostId = req.query.host_id ? parseInt(req.query.host_id, 10) : null;
    res.json(await db.getRunHistory(hostId));
  } catch (e) { next(e); }
}

module.exports = {
  listHosts, addHost, updateHost, removeHost, testHost, triggerRun,
  listVMs, getDashboard, getDrift, getStale, getSnapshots, getRuns,
};
