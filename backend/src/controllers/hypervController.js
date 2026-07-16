const db        = require('../services/hypervDbService');
const svc       = require('../services/hypervService');
const scheduler = require('../services/hypervSchedulerService');

// ── Hosts ─────────────────────────────────────────────────────────────────────

async function listHosts(req, res, next) {
  try { res.json(await db.listHosts()); } catch (e) { next(e); }
}

async function addHost(req, res, next) {
  try {
    const host = await db.upsertHost(req.body);
    scheduler.upsert(host, host.interval_minutes, host.scheduler_enabled);
    if (req.body.runNow) scheduler.runNow(host.id);
    res.status(201).json(host);
  } catch (e) { next(e); }
}

async function updateHost(req, res, next) {
  try {
    const host = await db.updateHostById(parseInt(req.params.id, 10), req.body);
    if (!host) return res.status(404).json({ error: 'Not found' });
    scheduler.upsert(host, host.interval_minutes, host.scheduler_enabled);
    res.json(host);
  } catch (e) { next(e); }
}

async function removeHost(req, res, next) {
  try {
    const id = parseInt(req.params.id, 10);
    const ok = await db.deleteHost(id);
    if (!ok) return res.status(404).json({ error: 'Not found' });
    scheduler.remove(id);
    res.status(204).end();
  } catch (e) { next(e); }
}

async function testHost(req, res, next) {
  try {
    const id = parseInt(req.params.id, 10);
    let effectivePassword = req.body.password || null;

    // Editing an existing host: the form intentionally leaves password blank
    // ("leave blank to keep current"), so fall back to the stored credential
    // when the user didn't type a new one.
    if (id) {
      const h = await db.getHostById(id);
      if (!h) return res.status(404).json({ error: 'Not found' });
      effectivePassword = effectivePassword || db.getDecryptedPassword(h);
    }

    const cfg = { ...req.body, password: effectivePassword };
    const result = await svc.testConnection(cfg);
    res.json(result);
  } catch (e) { next(e); }
}

async function triggerRun(req, res, next) {
  try {
    const id = parseInt(req.params.id, 10);
    scheduler.runNow(id);
    res.json({ started: true });
  } catch (e) { next(e); }
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
