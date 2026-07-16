/**
 * proxmoxController.js
 * --------------------
 * HTTP handlers for Proxmox VE / PDM discovery API.
 */

const db        = require('../services/proxmoxDbService');
const pxSvc     = require('../services/proxmoxService');
const scheduler = require('../services/proxmoxSchedulerService');

// ---------------------------------------------------------------------------
// Host management
// ---------------------------------------------------------------------------

async function listHosts(req, res) {
  const hosts = await db.listHosts();
  res.json(hosts.map(h => ({ ...h, is_running: scheduler.isRunning(h.id) })));
}

async function addHost(req, res) {
  const {
    host, hostType, username, realm,
    password, tokenId, tokenSecret,
    port, verifySSL, intervalMinutes, schedulerEnabled, runNow,
  } = req.body;

  if (!host || !username) {
    return res.status(400).json({ error: 'host and username are required' });
  }
  if (!password && !tokenSecret) {
    return res.status(400).json({ error: 'Either password or API token secret is required' });
  }

  const saved = await db.upsertHost({
    host, hostType, username, realm,
    password, tokenId, tokenSecret,
    port, verifySSL, intervalMinutes, schedulerEnabled,
  });
  scheduler.upsert(saved, saved.interval_minutes, saved.scheduler_enabled);
  if (runNow) scheduler.runNow(saved.id);
  res.json(saved);
}

async function updateHost(req, res) {
  const existing = await db.getHostById(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Host not found' });

  const {
    host, hostType, username, realm,
    password, tokenId, tokenSecret,
    port, verifySSL, intervalMinutes, schedulerEnabled,
  } = req.body;

  let saved;
  try {
    saved = await db.updateHostById(existing.id, {
      host:             host             ?? existing.host,
      hostType:         hostType         ?? existing.host_type,
      username:         username         ?? existing.username,
      realm:            realm            ?? existing.realm,
      password:         password         || null,      // null = keep existing
      tokenId:          tokenId          !== undefined ? tokenId : existing.token_id,
      tokenSecret:      tokenSecret      || null,
      port:             port             ?? existing.port,
      verifySSL:        verifySSL        !== undefined ? verifySSL : existing.verify_ssl,
      intervalMinutes:  intervalMinutes  ?? existing.interval_minutes,
      schedulerEnabled: schedulerEnabled !== undefined ? schedulerEnabled : existing.scheduler_enabled,
    });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Another host with that Hostname/IP already exists' });
    }
    throw err;
  }
  if (!saved) return res.status(404).json({ error: 'Host not found' });
  scheduler.upsert(saved, saved.interval_minutes, saved.scheduler_enabled);
  res.json(saved);
}

async function deleteHost(req, res) {
  const ok = await db.deleteHost(req.params.id);
  if (!ok) return res.status(404).json({ error: 'Host not found' });
  scheduler.remove(Number(req.params.id));
  res.json({ ok: true });
}

// Test a connection without saving (uses request body credentials, falling
// back to the saved host's stored password/token secret when editing an
// existing host without retyping them — mirrors vmwareController.testHost)
async function testHost(req, res) {
  const { host, hostType, username, realm, password, tokenId, tokenSecret, port, verifySSL } = req.body;
  if (!host || !username) return res.status(400).json({ error: 'host and username are required' });

  let effectivePassword = password || null;
  let effectiveTokenSecret = tokenSecret || null;

  const id = Number(req.params.id);
  if (id) {
    const existing = await db.getHostById(id);
    if (existing) {
      effectivePassword = effectivePassword || db.getDecryptedPassword(existing);
      effectiveTokenSecret = effectiveTokenSecret || db.getDecryptedTokenSecret(existing);
    }
  }

  try {
    const vms = await pxSvc.discover(
      host, port || (hostType === 'pdm' ? 8007 : 8006),
      username, realm || 'pam',
      effectivePassword, verifySSL,
      hostType || 've',
      tokenId || null, effectiveTokenSecret
    );
    res.json({ ok: true, vmCount: vms.length });
  } catch (err) {
    res.json({ ok: false, error: err.message });
  }
}

// Trigger background discovery for a saved host
async function runDiscovery(req, res) {
  const host = await db.getHostById(req.params.id);
  if (!host) return res.status(404).json({ error: 'Host not found' });
  scheduler.runNow(host.id);
  res.json({ ok: true });
}

// Synchronous one-shot discovery (waits for result — use for quick tests)
async function runDiscoverySync(req, res) {
  const { host, hostType, username, realm, password, tokenId, tokenSecret, port, verifySSL } = req.body;
  if (!host || !username) return res.status(400).json({ error: 'host and username are required' });

  let hostRecord = await db.getHostByName(host);
  if (!hostRecord) {
    hostRecord = await db.upsertHost({
      host, hostType: hostType || 've', username, realm: realm || 'pam',
      password, tokenId, tokenSecret, port, verifySSL,
      intervalMinutes: 60, schedulerEnabled: false,
    });
  }

  const runId = await db.startRun(hostRecord.id, host);
  try {
    const vms = await pxSvc.discover(
      host, port || hostRecord.port,
      username, realm || hostRecord.realm,
      password || db.getDecryptedPassword(hostRecord), verifySSL,
      hostType || hostRecord.host_type,
      tokenId || hostRecord.token_id || null, tokenSecret || db.getDecryptedTokenSecret(hostRecord)
    );
    await db.saveVMs(runId, hostRecord.id, host, vms);
    await db.finishRun(runId, vms.length);
    await db.setLastDiscovery(hostRecord.id, vms.length);
    res.json({ ok: true, vmCount: vms.length });
  } catch (err) {
    await db.failRun(runId, err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
}

// ---------------------------------------------------------------------------
// Data endpoints
// ---------------------------------------------------------------------------

async function listVMs(req, res) {
  const { search, status, vmType, hostId, page = 1, pageSize = 50 } = req.query;
  let vms = await db.getLatestVMs(hostId ? Number(hostId) : undefined);

  if (search) {
    const s = search.toLowerCase();
    vms = vms.filter(v =>
      (v.name  || '').toLowerCase().includes(s) ||
      (v.node  || '').toLowerCase().includes(s) ||
      (v.ips   || []).some(ip => ip.includes(s))
    );
  }
  if (status) vms = vms.filter(v => v.status === status);
  if (vmType) vms = vms.filter(v => v.vm_type === vmType);

  const total  = vms.length;
  const start  = (Number(page) - 1) * Number(pageSize);
  res.json({
    items:    vms.slice(start, start + Number(pageSize)),
    total,
    page:     Number(page),
    pageSize: Number(pageSize),
  });
}

async function getDashboard(req, res)    { res.json(await db.getDashboardStats()); }
async function getDrift(req, res)        { res.json(await db.getDrift()); }
async function getNodeTopology(req, res) { res.json(await db.getNodeTopology()); }
async function getStaleVMs(req, res)     { res.json(await db.getStaleVMs()); }
async function getSnapshots(req, res)    { res.json(await db.getSnapshotVMs()); }
async function getRunHistory(req, res) {
  res.json(await db.getRunHistory(req.query.hostId ? Number(req.query.hostId) : undefined));
}

async function exportCSV(req, res) {
  const vms = await db.getLatestVMs(req.query.hostId ? Number(req.query.hostId) : undefined);
  const header = 'VMID,Name,Type,Node,Status,CPUs,Memory(MB),Disk(GB),IPs,OS Type,Uptime(s),Template,Snapshots,Tags,Pool,Cluster,Source Host\n';
  const rows = vms.map(v =>
    [
      v.vmid, v.name, v.vm_type, v.node, v.status,
      v.cpu_count, v.memory_mb, v.disk_gb,
      (v.ips   || []).join('; '),
      v.os_type, v.uptime_seconds,
      v.is_template ? 'Yes' : 'No',
      v.snapshot_count,
      (v.tags  || []).join('; '),
      v.pool, v.cluster, v.source_host,
    ].map(x => `"${(x ?? '').toString().replace(/"/g, '""')}"`).join(',')
  ).join('\n');
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="proxmox-inventory.csv"');
  res.send(header + rows);
}

module.exports = {
  listHosts, addHost, updateHost, deleteHost, testHost,
  runDiscovery, runDiscoverySync,
  listVMs, exportCSV,
  getDashboard, getDrift, getNodeTopology, getStaleVMs, getSnapshots, getRunHistory,
};
