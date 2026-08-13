const db          = require('../services/hypervDbService');
const svc         = require('../services/hypervService');
const scheduler   = require('../services/hypervSchedulerService');
const macLookupSvc = require('../services/macLookupService');

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
      vms = vms.filter(v => (v.name || '').toLowerCase().includes(q) || (v.hostname || '').toLowerCase().includes(q) || (v.source_host || '').toLowerCase().includes(q));
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

async function getDriftHistory(req, res, next) {
  try {
    const days = Math.min(30, Math.max(1, Number(req.query.days) || 7));
    res.json({ history: await db.getDriftHistory(days) });
  } catch (e) { next(e); }
}

async function getDriftActivity(req, res, next) {
  try {
    const days = Math.min(30, Math.max(1, Number(req.query.days) || 7));
    res.json({ activity: await db.getDriftActivity(days) });
  } catch (e) { next(e); }
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

    const { hostId, search, matchFilter, state } = req.query;
    const vms = await db.getLatestVMs(hostId ? Number(hostId) : undefined);

    const results = vms.map(vm => {
      const macs = Array.isArray(vm.mac_addresses) ? vm.mac_addresses : [];
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
        os_type:      vm.os_type,
        ips:          vm.ips || [],
        macs,
        matched_macs: [...matchedMacs],
        state:        vm.state,
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
    if (state) filtered = filtered.filter(r => r.state === state);

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
      'Name','Hostname','OS Type',
      'VM IPs','MAC Addresses','Matched MACs','Mapped IPs',
      'LAN Segment','VLAN Group','Data Retrieved','State','Source Host',
    ];
    const lines = [headers.join(',')];
    for (const vm of vms) {
      const macs = Array.isArray(vm.mac_addresses) ? vm.mac_addresses : [];
      const matches = [];
      for (const mac of macs) {
        const norm = macLookupSvc.normalizeMAC(mac);
        if (norm && index[norm]) matches.push(index[norm]);
      }
      const mappedIPs = [...new Set(matches.map(m => m.ip_address).filter(Boolean))].join(' | ');
      lines.push([
        vm.name, vm.hostname, vm.os_type,
        (vm.ips || []).join('; '), macs.join('; '),
        matches.length ? 'Yes' : 'No', mappedIPs,
        [...new Set(matches.map(m => m.lan_segment).filter(Boolean))].join(' | '),
        [...new Set(matches.map(m => m.vlan_group).filter(Boolean))].join(' | '),
        [...new Set(matches.map(m => m.data_retrieved).filter(Boolean))].join(' | '),
        vm.state, vm.source_host,
      ].map(x => `"${(x ?? '').toString().replace(/"/g, '""')}"`).join(','));
    }
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="hyperv_mac_lookup.csv"');
    res.send(lines.join('\n'));
  } catch (e) { next(e); }
}

module.exports = {
  listHosts, addHost, updateHost, removeHost, testHost, triggerRun,
  listVMs, getDashboard, getDrift, getDriftHistory, getDriftActivity, getStale, getSnapshots, getRuns,
  getMacLookup, exportMacLookupCSV,
};
