/**
 * vmwareController.js
 * -------------------
 * HTTP handlers for VMware discovery endpoints.
 */

const dbSvc          = require('../services/vmwareDbService');
const vmSvc          = require('../services/vmwareService');
const scheduler      = require('../services/vmwareSchedulerService');
const macLookupSvc   = require('../services/macLookupService');
const assetEditorSvc = require('../services/vmwareAssetEditorService');

// ---------------------------------------------------------------------------
// Hosts / credentials
// ---------------------------------------------------------------------------

async function listHosts(req, res, next) {
  try {
    const hosts = await dbSvc.listHosts();
    const active = scheduler.activeHosts();
    const enriched = hosts.map(h => ({
      ...h,
      is_running: active.includes(h.host) || h.is_running,
    }));
    res.json({ hosts: enriched });
  } catch (e) { next(e); }
}

async function addHost(req, res, next) {
  try {
    const {
      host, username, password, port = 443,
      verifySSL = false, intervalMinutes = 60, schedulerEnabled = false,
    } = req.body;

    if (!host || !username || !password) {
      return res.status(400).json({ error: 'host, username, and password are required' });
    }

    const record = await dbSvc.upsertHost({
      host, username, password,
      port: Number(port),
      verifySSL: Boolean(verifySSL),
      intervalMinutes: Math.max(5, Number(intervalMinutes)),
      schedulerEnabled: Boolean(schedulerEnabled),
    });

    scheduler.upsert(host, record.interval_minutes, record.scheduler_enabled);

    if (req.body.runNow) {
      scheduler.runNow(host);
    }

    res.status(201).json({ host: record });
  } catch (e) { next(e); }
}

async function updateHost(req, res, next) {
  try {
    const { id } = req.params;
    const existing = await dbSvc.getHostById(id);
    if (!existing) return res.status(404).json({ error: 'Host not found' });

    const {
      username, password, port, verifySSL, intervalMinutes, schedulerEnabled,
    } = req.body;

    // Keep existing password if not supplied
    const finalPassword = password || dbSvc.getDecryptedPassword(existing);

    const record = await dbSvc.upsertHost({
      host:             existing.host,
      username:         username         ?? existing.username,
      password:         finalPassword,
      port:             Number(port      ?? existing.port),
      verifySSL:        Boolean(verifySSL ?? existing.verify_ssl),
      intervalMinutes:  Math.max(5, Number(intervalMinutes ?? existing.interval_minutes)),
      schedulerEnabled: Boolean(schedulerEnabled ?? existing.scheduler_enabled),
    });

    scheduler.upsert(record.host, record.interval_minutes, record.scheduler_enabled);

    if (req.body.runNow) scheduler.runNow(record.host);

    res.json({ host: record });
  } catch (e) { next(e); }
}

async function deleteHost(req, res, next) {
  try {
    const { id } = req.params;
    const record = await dbSvc.getHostById(id);
    if (!record) return res.status(404).json({ error: 'Host not found' });

    scheduler.remove(record.host);
    await dbSvc.deleteHost(id);
    res.status(204).end();
  } catch (e) { next(e); }
}

async function testHost(req, res, next) {
  try {
    const { id } = req.params;
    const record = await dbSvc.getHostById(id);
    if (!record) return res.status(404).json({ error: 'Host not found' });

    const password = dbSvc.getDecryptedPassword(record);
    try {
      const vms = await vmSvc.discover(record.host, record.port, record.username, password, record.verify_ssl);
      res.json({ ok: true, vmCount: vms.length });
    } catch (err) {
      if (err instanceof vmSvc.VMwareAuthError) {
        res.json({ ok: false, error: `Authentication failed: ${err.message}` });
      } else {
        res.json({ ok: false, error: `Connection failed: ${err.message}` });
      }
    }
  } catch (e) { next(e); }
}

// ---------------------------------------------------------------------------
// Discovery trigger
// ---------------------------------------------------------------------------

async function runDiscovery(req, res, next) {
  try {
    const { id } = req.params;
    const record = await dbSvc.getHostById(id);
    if (!record) return res.status(404).json({ error: 'Host not found' });

    if (scheduler.isRunning(record.host)) {
      return res.status(409).json({ error: 'Discovery already running for this host' });
    }

    scheduler.runNow(record.host);
    res.json({ message: `Discovery triggered for ${record.host}` });
  } catch (e) { next(e); }
}

// Trigger discovery immediately, wait for result (used for first-time setup)
async function runDiscoverySync(req, res, next) {
  try {
    const { host, username, password, port = 443, verifySSL = false } = req.body;
    if (!host || !username || !password) {
      return res.status(400).json({ error: 'host, username, and password are required' });
    }

    // Find or create host record
    let record = await dbSvc.getHostByName(host);
    if (!record) {
      record = await dbSvc.upsertHost({
        host, username, password,
        port: Number(port), verifySSL: Boolean(verifySSL),
        intervalMinutes: 60, schedulerEnabled: false,
      });
    }

    if (scheduler.isRunning(host)) {
      return res.status(409).json({ error: 'Discovery already running for this host' });
    }

    const decryptedPw = password || dbSvc.getDecryptedPassword(record);

    let runId;
    try {
      runId = await dbSvc.startRun(record.id, host);
      await dbSvc.setHostRunning(record.id, true);
      const vms = await vmSvc.discover(host, Number(port), username, decryptedPw, Boolean(verifySSL));
      await dbSvc.saveVMs(runId, record.id, host, vms);
      await dbSvc.finishRun(runId, vms.length);
      await dbSvc.setLastDiscovery(record.id, vms.length);
      res.json({ message: 'Discovery complete', vmCount: vms.length, host });
    } catch (err) {
      await dbSvc.setHostRunning(record.id, false);
      if (runId) await dbSvc.failRun(runId, err.message);
      if (err instanceof vmSvc.VMwareAuthError) {
        return res.status(401).json({ error: err.message });
      }
      if (err instanceof vmSvc.VMwareConnectionError) {
        return res.status(502).json({ error: err.message });
      }
      throw err;
    }
  } catch (e) { next(e); }
}

// ---------------------------------------------------------------------------
// VM data endpoints
// ---------------------------------------------------------------------------

async function listVMs(req, res, next) {
  try {
    const { hostId, search, powerState, page = 1, pageSize = 50 } = req.query;
    let vms = await dbSvc.getLatestVMs(hostId);

    if (search) {
      const q = search.toLowerCase();
      vms = vms.filter(v =>
        (v.name || '').toLowerCase().includes(q) ||
        (v.hostname || '').toLowerCase().includes(q) ||
        (v.ips || []).some(ip => ip.includes(q)) ||
        (v.os_version || '').toLowerCase().includes(q)
      );
    }
    if (powerState) {
      vms = vms.filter(v => v.power_state === powerState);
    }

    const total = vms.length;
    const start = (Number(page) - 1) * Number(pageSize);
    const items = vms.slice(start, start + Number(pageSize));
    res.json({ total, items });
  } catch (e) { next(e); }
}

async function getDashboard(req, res, next) {
  try {
    res.json(await dbSvc.getDashboardStats());
  } catch (e) { next(e); }
}

async function getDrift(req, res, next) {
  try {
    res.json({ drift: await dbSvc.getDrift() });
  } catch (e) { next(e); }
}

async function getESXiTopology(req, res, next) {
  try {
    res.json({ topology: await dbSvc.getESXiTopology() });
  } catch (e) { next(e); }
}

async function getReconciliation(req, res, next) {
  try {
    res.json(await dbSvc.getReconciliation());
  } catch (e) { next(e); }
}

async function getStaleVMs(req, res, next) {
  try {
    res.json(await dbSvc.getStaleVMs());
  } catch (e) { next(e); }
}

async function getSnapshots(req, res, next) {
  try {
    res.json({ snapshots: await dbSvc.getSnapshotVMs() });
  } catch (e) { next(e); }
}

async function getRunHistory(req, res, next) {
  try {
    const { hostId } = req.query;
    res.json({ runs: await dbSvc.getRunHistory(hostId) });
  } catch (e) { next(e); }
}

// Export VMs as CSV
async function exportCSV(req, res, next) {
  try {
    const { hostId } = req.query;
    const vms = await dbSvc.getLatestVMs(hostId);

    const headers = ['Name','Hostname','IPs','ESXi Host','ESXi Host IP','OS Type','OS Version','MACs','Power State','Tools','CPU','Memory MB','Snapshots','Source Host'];
    const rows = vms.map(v => [
      v.name, v.hostname,
      (v.ips  || []).join(' | '),
      v.esxi_host_name, v.esxi_host_ip,
      v.os_type, v.os_version,
      (v.macs || []).join(' | '),
      v.power_state, v.tools_status,
      v.num_cpu, v.memory_mb,
      v.snapshot_count,
      v.source_host,
    ].map(c => `"${String(c ?? '').replace(/"/g, '""')}"`));

    const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\r\n');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="vmware_vms.csv"');
    res.send(csv);
  } catch (e) { next(e); }
}

// ---------------------------------------------------------------------------
// MAC Lookup
// ---------------------------------------------------------------------------

async function listMacFiles(req, res, next) {
  try {
    res.json({ files: macLookupSvc.listFiles() });
  } catch (e) { next(e); }
}

async function uploadMacFile(req, res, next) {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const ext = (req.file.originalname || '').toLowerCase();
    if (!ext.endsWith('.csv') && !ext.endsWith('.xlsx') && !ext.endsWith('.xls')) {
      return res.status(400).json({ error: 'Only .csv and .xlsx files are supported' });
    }

    let rows, meta;
    try {
      ({ rows, meta } = await macLookupSvc.parseFile(req.file.buffer, req.file.originalname));
    } catch (parseErr) {
      return res.status(400).json({ error: `Could not read "${req.file.originalname}" — file may be corrupted or not a valid ${ext.endsWith('.csv') ? 'CSV' : 'Excel'} file (${parseErr.message})` });
    }
    if (!rows.length) {
      return res.status(422).json({
        error: 'No valid MAC rows found. Check column headers (MAC Address, IP Address).',
        meta,
      });
    }

    const id = macLookupSvc.saveFile(rows, meta);
    res.status(201).json({ id, ...meta });
  } catch (e) { next(e); }
}

async function deleteMacFile(req, res, next) {
  try {
    const deleted = macLookupSvc.deleteFile(req.params.id);
    if (!deleted) return res.status(404).json({ error: 'File not found' });
    res.status(204).end();
  } catch (e) { next(e); }
}

async function clearMacFiles(req, res, next) {
  try {
    const count = macLookupSvc.clearAll();
    res.json({ deleted: count });
  } catch (e) { next(e); }
}

async function getMacLookup(req, res, next) {
  try {
    const rows  = macLookupSvc.loadAllRows();
    const index = macLookupSvc.buildIndex(rows);
    const files = macLookupSvc.listFiles();
    const totalMappingEntries = rows.length;

    const { hostId, search, matchFilter, powerState } = req.query;
    let vms = await dbSvc.getLatestVMs(hostId);

    const results = vms.map(vm => {
      const macs   = Array.isArray(vm.macs) ? vm.macs : [];
      const matches = [];
      const matchedMacs = new Set();

      for (const mac of macs) {
        const norm = macLookupSvc.normalizeMAC(mac);
        if (norm && index[norm]) {
          matches.push({ mac, entry: index[norm] });
          matchedMacs.add(mac);
        }
      }

      const mappedIPs    = [...new Set(matches.map(m => m.entry.ip_address).filter(Boolean))].join(' | ');
      const dataRetrieved = [...new Set(matches.map(m => m.entry.data_retrieved).filter(Boolean))].join(' | ');
      const lanSegment   = [...new Set(matches.map(m => m.entry.lan_segment).filter(Boolean))].join(' | ');
      const vlanGroup    = [...new Set(matches.map(m => m.entry.vlan_group).filter(Boolean))].join(' | ');

      return {
        id:              vm.id,
        name:            vm.name,
        hostname:        vm.hostname,
        esxi_host_name:  vm.esxi_host_name,
        esxi_host_ip:    vm.esxi_host_ip,
        os_type:         vm.os_type,
        os_version:      vm.os_version,
        ips:             vm.ips || [],
        macs:            macs,
        matched_macs:    [...matchedMacs],
        power_state:     vm.power_state,
        source_host:     vm.source_host,
        is_matched:      matches.length > 0,
        mapped_ips:      mappedIPs,
        data_retrieved:  dataRetrieved,
        lan_segment:     lanSegment,
        vlan_group:      vlanGroup,
      };
    });

    // Apply filters
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
    if (powerState) filtered = filtered.filter(r => r.power_state === powerState);

    const matched   = filtered.filter(r => r.is_matched).length;
    const unmatched = filtered.length - matched;

    res.json({
      results: filtered,
      stats: {
        total:          filtered.length,
        matched,
        unmatched,
        mapping_entries: totalMappingEntries,
        has_mapping:    rows.length > 0,
      },
      files,
    });
  } catch (e) { next(e); }
}

async function exportMacLookupCSV(req, res, next) {
  try {
    const rows  = macLookupSvc.loadAllRows();
    const index = macLookupSvc.buildIndex(rows);
    const vms   = await dbSvc.getLatestVMs();

    const headers = [
      'VM Name','Hostname','ESXi Host','ESXi Host IP','OS Type','OS Version',
      'VM IPs','MAC Addresses','Matched MACs','Mapped IPs',
      'LAN Segment','VLAN Group','Data Retrieved','Power State','Source Host',
    ];

    const csvRows = vms.map(vm => {
      const macs    = Array.isArray(vm.macs) ? vm.macs : [];
      const matches = [];
      const matchedMacs = [];
      for (const mac of macs) {
        const norm = macLookupSvc.normalizeMAC(mac);
        if (norm && index[norm]) { matches.push(index[norm]); matchedMacs.push(mac); }
      }
      const q = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
      return [
        q(vm.name),
        q(vm.hostname),
        q(vm.esxi_host_name),
        q(vm.esxi_host_ip),
        q(vm.os_type),
        q(vm.os_version),
        q((vm.ips  || []).join(' | ')),
        q(macs.join(' | ')),
        q(matchedMacs.join(' | ')),
        q([...new Set(matches.map(m => m.ip_address).filter(Boolean))].join(' | ')),
        q([...new Set(matches.map(m => m.lan_segment).filter(Boolean))].join(' | ')),
        q([...new Set(matches.map(m => m.vlan_group).filter(Boolean))].join(' | ')),
        q([...new Set(matches.map(m => m.data_retrieved).filter(Boolean))].join(' | ')),
        q(vm.power_state),
        q(vm.source_host),
      ].join(',');
    });

    const csv = [headers.map(h => `"${h}"`).join(','), ...csvRows].join('\r\n');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="mac_lookup.csv"');
    res.send(csv);
  } catch (e) { next(e); }
}

// ---------------------------------------------------------------------------
// Asset Editor
// ---------------------------------------------------------------------------

async function getAssetEditor(req, res, next) {
  try {
    const { search, filter } = req.query;

    // Load discovered VMs and edit overrides in parallel
    const [vms, editsMap] = await Promise.all([
      dbSvc.getLatestVMs(),
      assetEditorSvc.loadAllEdits(),
    ]);

    // Build MAC lookup index
    const macRows  = macLookupSvc.loadAllRows();
    const macIndex = macLookupSvc.buildIndex(macRows);

    const results = vms.map(vm => {
      const macs       = Array.isArray(vm.macs) ? vm.macs : [];
      const vmIps      = Array.isArray(vm.ips)  ? vm.ips.filter(ip => ip && ip !== 'Not Available') : [];
      const sourceHost = vm.source_host || '';
      const vmName     = vm.name        || '';

      // MAC-mapped IPs
      const macMatches = [];
      const matchedMacs = [];
      for (const mac of macs) {
        const norm = macLookupSvc.normalizeMAC(mac);
        if (norm && macIndex[norm]) { macMatches.push(macIndex[norm]); matchedMacs.push(mac); }
      }
      const mappedIPs = [...new Set(macMatches.map(m => m.ip_address).filter(Boolean))];

      // Ordered, deduplicated display IP list (mapped first, then VMware)
      const seen = new Set();
      const displayIPs = [];
      for (const ip of mappedIPs) {
        if (ip && !seen.has(ip.toLowerCase())) {
          displayIPs.push({ ip, src: 'mac' });
          seen.add(ip.toLowerCase());
        }
      }
      for (const ip of vmIps) {
        if (ip && !seen.has(ip.toLowerCase())) {
          displayIPs.push({ ip, src: 'vmware' });
          seen.add(ip.toLowerCase());
        }
      }

      // Edit overlay
      const key  = `${sourceHost.toLowerCase()}|||${vmName.toLowerCase()}`;
      const edit = editsMap[key] || null;

      return {
        id:             vm.id,
        name:           vmName,
        source_host:    sourceHost,
        hostname:       vm.hostname,
        esxi_host_name: vm.esxi_host_name,
        esxi_host_ip:   vm.esxi_host_ip,
        os_type:        vm.os_type,
        os_version:     vm.os_version,
        power_state:    vm.power_state,
        macs,
        matched_macs:   matchedMacs,
        ips:            vmIps,
        display_ips:    displayIPs,
        mapped_ips:     mappedIPs.join(' | '),
        lan_segment:    [...new Set(macMatches.map(m => m.lan_segment).filter(Boolean))].join(' | '),
        vlan_group:     [...new Set(macMatches.map(m => m.vlan_group).filter(Boolean))].join(' | '),
        is_matched:     matchedMacs.length > 0,
        has_edit:       !!edit,
        edit: edit ? {
          id:         edit.id,
          asset_name: edit.asset_name || vmName,
          hostname:   edit.hostname   || vm.hostname || '',
          ip_address: edit.ip_address || (displayIPs[0]?.ip || ''),
          os_type:    edit.os_type    || vm.os_type  || '',
          os_version: edit.os_version || vm.os_version || '',
          notes:      edit.notes      || '',
          updated_at: edit.updated_at || '',
        } : {
          asset_name: vmName,
          hostname:   vm.hostname || '',
          ip_address: displayIPs[0]?.ip || '',
          os_type:    vm.os_type  || '',
          os_version: vm.os_version || '',
          notes:      '',
          updated_at: '',
        },
      };
    });

    // Stats
    const stats = {
      total:    results.length,
      matched:  results.filter(r => r.is_matched).length,
      unmatched: results.filter(r => !r.is_matched).length,
      edited:   results.filter(r => r.has_edit).length,
    };

    // Apply filters
    let filtered = results;
    if (filter === 'matched')   filtered = filtered.filter(r => r.is_matched);
    if (filter === 'unmatched') filtered = filtered.filter(r => !r.is_matched);
    if (filter === 'edited')    filtered = filtered.filter(r => r.has_edit);
    if (search) {
      const q = search.toLowerCase();
      filtered = filtered.filter(r =>
        (r.name        || '').toLowerCase().includes(q) ||
        (r.hostname    || '').toLowerCase().includes(q) ||
        (r.mapped_ips  || '').includes(q) ||
        (r.ips         || []).some(ip => ip.includes(q)) ||
        (r.macs        || []).some(m  => m.toLowerCase().includes(q)) ||
        (r.source_host || '').toLowerCase().includes(q)
      );
    }

    res.json({ results: filtered, stats });
  } catch (e) { next(e); }
}

async function saveAssetEdit(req, res, next) {
  try {
    const { source_host, vm_name, asset_name, hostname, ip_address, os_type, os_version, notes } = req.body;
    if (!source_host || !vm_name) {
      return res.status(400).json({ error: 'source_host and vm_name are required' });
    }
    await assetEditorSvc.saveEdit(source_host, vm_name, { asset_name, hostname, ip_address, os_type, os_version, notes });
    res.json({ ok: true });
  } catch (e) { next(e); }
}

async function resetAssetEdit(req, res, next) {
  try {
    const { source_host, vm_name } = req.body;
    if (!source_host || !vm_name) {
      return res.status(400).json({ error: 'source_host and vm_name are required' });
    }
    const deleted = await assetEditorSvc.deleteEdit(source_host, vm_name);
    if (!deleted) return res.status(404).json({ error: 'No edit found for this VM' });
    res.json({ ok: true });
  } catch (e) { next(e); }
}

async function exportAssetEditorCSV(req, res, next) {
  try {
    const [vms, editsMap] = await Promise.all([dbSvc.getLatestVMs(), assetEditorSvc.loadAllEdits()]);
    const macRows  = macLookupSvc.loadAllRows();
    const macIndex = macLookupSvc.buildIndex(macRows);

    const headers = [
      'VM Name','Asset Name (Edit)','Hostname (Edit)','IP Address (Edit)',
      'OS Type (Edit)','OS Version (Edit)','Notes',
      'VM IPs','MAC Addresses','Mapped IPs','LAN Segment','VLAN Group',
      'Power State','ESXi Host','Source / vCenter','Last Edited',
    ];

    const q = v => `"${String(v ?? '').replace(/"/g, '""')}"`;

    const csvRows = vms.map(vm => {
      const macs    = Array.isArray(vm.macs) ? vm.macs : [];
      const vmIps   = Array.isArray(vm.ips)  ? vm.ips.filter(ip => ip && ip !== 'Not Available') : [];
      const matches = [];
      for (const mac of macs) {
        const norm = macLookupSvc.normalizeMAC(mac);
        if (norm && macIndex[norm]) matches.push(macIndex[norm]);
      }
      const mappedIPs  = [...new Set(matches.map(m => m.ip_address).filter(Boolean))].join(' | ');
      const lanSegment = [...new Set(matches.map(m => m.lan_segment).filter(Boolean))].join(' | ');
      const vlanGroup  = [...new Set(matches.map(m => m.vlan_group).filter(Boolean))].join(' | ');
      const key  = `${(vm.source_host || '').toLowerCase()}|||${(vm.name || '').toLowerCase()}`;
      const edit = editsMap[key];

      return [
        q(vm.name),
        q(edit?.asset_name || ''),
        q(edit?.hostname   || ''),
        q(edit?.ip_address || ''),
        q(edit?.os_type    || ''),
        q(edit?.os_version || ''),
        q(edit?.notes      || ''),
        q(vmIps.join(' | ')),
        q(macs.join(' | ')),
        q(mappedIPs),
        q(lanSegment),
        q(vlanGroup),
        q(vm.power_state),
        q(vm.esxi_host_name),
        q(vm.source_host),
        q(edit?.updated_at || ''),
      ].join(',');
    });

    const csv = [headers.map(h => `"${h}"`).join(','), ...csvRows].join('\r\n');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="asset_editor.csv"');
    res.send(csv);
  } catch (e) { next(e); }
}

module.exports = {
  listHosts, addHost, updateHost, deleteHost, testHost,
  runDiscovery, runDiscoverySync,
  listVMs, getDashboard, getDrift, getESXiTopology, getReconciliation,
  getStaleVMs, getSnapshots, getRunHistory, exportCSV,
  // MAC Lookup
  listMacFiles, uploadMacFile, deleteMacFile, clearMacFiles,
  getMacLookup, exportMacLookupCSV,
  // Asset Editor
  getAssetEditor, saveAssetEdit, resetAssetEdit, exportAssetEditorCSV,
};
