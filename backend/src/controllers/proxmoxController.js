/**
 * proxmoxController.js
 * --------------------
 * HTTP handlers for Proxmox VE / PDM discovery API.
 */

const db          = require('../services/proxmoxDbService');
const pxSvc       = require('../services/proxmoxService');
const scheduler   = require('../services/proxmoxSchedulerService');
const macLookupSvc = require('../services/macLookupService');

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
    const { vms } = await pxSvc.discover(
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
    const { vms, nodes } = await pxSvc.discover(
      host, port || hostRecord.port,
      username, realm || hostRecord.realm,
      password || db.getDecryptedPassword(hostRecord), verifySSL,
      hostType || hostRecord.host_type,
      tokenId || hostRecord.token_id || null, tokenSecret || db.getDecryptedTokenSecret(hostRecord)
    );
    await db.saveVMs(runId, hostRecord.id, host, vms);
    await db.saveNodes(runId, hostRecord.id, host, nodes);
    await db.finishRun(runId, vms.length);
    await db.setLastDiscovery(hostRecord.id, vms.length);
    res.json({ ok: true, vmCount: vms.length, nodeCount: nodes.length });
  } catch (err) {
    await db.failRun(runId, err.message);
    await db.setLastDiscoveryFailed(hostRecord.id, err.message);
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
      (v.name     || '').toLowerCase().includes(s) ||
      (v.hostname || '').toLowerCase().includes(s) ||
      (v.node     || '').toLowerCase().includes(s) ||
      (v.ips      || []).some(ip => ip.includes(s))
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

async function listNodes(req, res) {
  const nodes = await db.getLatestNodes(req.query.hostId ? Number(req.query.hostId) : undefined);
  res.json({ items: nodes, total: nodes.length });
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
  const header = 'VMID,Name,Hostname,Type,Node,Status,CPUs,Memory(MB),Disk(GB),IPs,OS Type,Uptime(s),Template,Snapshots,Tags,Pool,Cluster,Source Host\n';
  const rows = vms.map(v =>
    [
      v.vmid, v.name, v.hostname, v.vm_type, v.node, v.status,
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

// ---------------------------------------------------------------------------
// MAC Lookup — matches against the mapping files uploaded from VMware
// Discovery's Upload Mapping tab. The mapping store is shared across
// hypervisors (MAC addresses are globally unique), so no separate upload
// UI is needed here.
// ---------------------------------------------------------------------------

async function getMacLookup(req, res, next) {
  try {
    const rows  = macLookupSvc.loadAllRows();
    const index = macLookupSvc.buildIndex(rows);
    const files = macLookupSvc.listFiles();
    const totalMappingEntries = rows.length;

    const { hostId, search, matchFilter, status } = req.query;
    const vms = await db.getLatestVMs(hostId ? Number(hostId) : undefined);

    const results = vms.map(vm => {
      const macs = Array.isArray(vm.macs) ? vm.macs : [];
      const matches = [];
      const matchedMacs = new Set();

      for (const mac of macs) {
        const norm = macLookupSvc.normalizeMAC(mac);
        if (norm && index[norm]) {
          matches.push({ mac, entry: index[norm] });
          matchedMacs.add(mac);
        }
      }

      const mappedIPs     = [...new Set(matches.map(m => m.entry.ip_address).filter(Boolean))].join(' | ');
      const dataRetrieved = [...new Set(matches.map(m => m.entry.data_retrieved).filter(Boolean))].join(' | ');
      const lanSegment    = [...new Set(matches.map(m => m.entry.lan_segment).filter(Boolean))].join(' | ');
      const vlanGroup     = [...new Set(matches.map(m => m.entry.vlan_group).filter(Boolean))].join(' | ');

      return {
        id:           vm.id,
        name:         vm.name,
        hostname:     vm.hostname,
        node:         vm.node,
        os_type:      vm.os_type,
        ips:          vm.ips || [],
        macs,
        matched_macs: [...matchedMacs],
        status:       vm.status,
        source_host:  vm.source_host,
        is_matched:   matches.length > 0,
        mapped_ips:   mappedIPs,
        data_retrieved: dataRetrieved,
        lan_segment:  lanSegment,
        vlan_group:   vlanGroup,
      };
    });

    let filtered = results;
    if (search) {
      const q = search.toLowerCase();
      filtered = filtered.filter(r =>
        (r.name     || '').toLowerCase().includes(q) ||
        (r.hostname || '').toLowerCase().includes(q) ||
        (r.ips      || []).some(ip => ip.includes(q)) ||
        (r.macs     || []).some(m  => m.toLowerCase().includes(q)) ||
        (r.mapped_ips || '').includes(q)
      );
    }
    if (matchFilter === 'matched')   filtered = filtered.filter(r => r.is_matched);
    if (matchFilter === 'unmatched') filtered = filtered.filter(r => !r.is_matched);
    if (status) filtered = filtered.filter(r => r.status === status);

    const matched   = filtered.filter(r => r.is_matched).length;
    const unmatched = filtered.length - matched;

    res.json({
      results: filtered,
      stats: {
        total: filtered.length,
        matched,
        unmatched,
        mapping_entries: totalMappingEntries,
        has_mapping: rows.length > 0,
      },
      files,
    });
  } catch (e) { next(e); }
}

async function exportMacLookupCSV(req, res, next) {
  try {
    const rows  = macLookupSvc.loadAllRows();
    const index = macLookupSvc.buildIndex(rows);
    const vms   = await db.getLatestVMs();

    const headers = [
      'VMID','Name','Hostname','Node','OS Type',
      'VM IPs','MAC Addresses','Matched MACs','Mapped IPs',
      'LAN Segment','VLAN Group','Data Retrieved','Status','Source Host',
    ];
    const lines = [headers.join(',')];
    for (const vm of vms) {
      const macs = Array.isArray(vm.macs) ? vm.macs : [];
      const matches = [];
      for (const mac of macs) {
        const norm = macLookupSvc.normalizeMAC(mac);
        if (norm && index[norm]) matches.push(index[norm]);
      }
      const mappedIPs = [...new Set(matches.map(m => m.ip_address).filter(Boolean))].join(' | ');
      lines.push([
        vm.vmid, vm.name, vm.hostname, vm.node, vm.os_type,
        (vm.ips || []).join('; '), macs.join('; '),
        matches.length ? 'Yes' : 'No', mappedIPs,
        [...new Set(matches.map(m => m.lan_segment).filter(Boolean))].join(' | '),
        [...new Set(matches.map(m => m.vlan_group).filter(Boolean))].join(' | '),
        [...new Set(matches.map(m => m.data_retrieved).filter(Boolean))].join(' | '),
        vm.status, vm.source_host,
      ].map(x => `"${(x ?? '').toString().replace(/"/g, '""')}"`).join(','));
    }
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="proxmox_mac_lookup.csv"');
    res.send(lines.join('\n'));
  } catch (e) { next(e); }
}

module.exports = {
  listHosts, addHost, updateHost, deleteHost, testHost,
  runDiscovery, runDiscoverySync,
  listVMs, exportCSV, listNodes,
  getDashboard, getDrift, getNodeTopology, getStaleVMs, getSnapshots, getRunHistory,
  getMacLookup, exportMacLookupCSV,
};
