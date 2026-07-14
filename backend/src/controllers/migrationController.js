const multer  = require('multer');
const ExcelJS = require('exceljs');
const svc     = require('../services/migrationService');
const teams   = require('../services/teamsNotificationService');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

// ── PROJECTS ─────────────────────────────────────────────────────────────────
async function listProjects(req, res, next) {
  try { res.json(await svc.getProjects()); } catch (e) { next(e); }
}

async function getTabConfig(req, res, next) {
  try { res.json(await svc.getTabConfig(req.query.project_id)); } catch (e) { next(e); }
}

async function listCustomTabs(req, res, next) {
  try { res.json(await svc.getCustomTabs(req.query.project_id)); } catch (e) { next(e); }
}

async function getFieldDefs(req, res, next) {
  try { res.json(await svc.getFieldDefs(req.query.project_id, req.query.tab_key)); } catch (e) { next(e); }
}

async function getFieldValues(req, res, next) {
  try {
    const ids = (req.query.record_ids || '').split(',').filter(Boolean);
    res.json(await svc.getFieldValues(req.query.record_type, ids));
  } catch (e) { next(e); }
}

async function setFieldValue(req, res, next) {
  try {
    const { field_def_id, record_type, record_id, value } = req.body;
    res.json(await svc.setFieldValue(field_def_id, record_type, record_id, value));
  } catch (e) { next(e); }
}

// ── CUSTOM VMs ────────────────────────────────────────────────────────────────
async function listCustomVMs(req, res, next) {
  try { res.json(await svc.listCustomVMs(req.query)); } catch (e) { next(e); }
}

async function customVMSummary(req, res, next) {
  try { res.json(await svc.customVMSummary(req.query.tab_id)); } catch (e) { next(e); }
}

async function patchCustomVM(req, res, next) {
  try {
    const row = await svc.patchCustomVM(req.params.id, req.body);
    if (!row) return res.status(404).json({ error: 'VM not found' });
    if (req.body.migration_status) {
      const by = req.user?.full_name || req.user?.email;
      teams.notifyMigrationStatus(row.vm || `VM #${row.id}`, 'Custom VMs', req.body.migration_status, by, row.primary_ip).catch(() => {});
    }
    res.json(row);
  } catch (e) { next(e); }
}

async function customFilterOptions(req, res, next) {
  try { res.json(await svc.customFilterOptions(req.query.tab_id)); } catch (e) { next(e); }
}

// ── OVERVIEW ─────────────────────────────────────────────────────────────────
async function overview(req, res, next) {
  try { res.json(await svc.overview(req.query.project_id)); } catch (e) { next(e); }
}

// ── HOSTS ─────────────────────────────────────────────────────────────────────
async function listHosts(req, res, next) {
  try { res.json(await svc.listHosts(req.query)); } catch (e) { next(e); }
}

async function hostsSummary(req, res, next) {
  try { res.json(await svc.hostsSummary(req.query.project_id)); } catch (e) { next(e); }
}

async function getHostCredentials(req, res, next) {
  try {
    if (!req.user?.can_view_passwords) return res.status(403).json({ error: 'Credential access not permitted for your account.' });
    const creds = await svc.getHostCredentials(req.params.id);
    if (!creds) return res.status(404).json({ error: 'Host not found' });
    res.json(creds);
  } catch (e) { next(e); }
}

async function patchHost(req, res, next) {
  try {
    const row = await svc.patchHost(req.params.id, req.body);
    if (!row) return res.status(404).json({ error: 'Host not found or no valid fields provided' });
    if (req.body.migration_status || req.body.vms_vacate || req.body.proxmox_install || req.body.vm_migration_back) {
      const status = req.body.migration_status || req.body.vms_vacate || req.body.proxmox_install || req.body.vm_migration_back;
      const by = req.user?.full_name || req.user?.email;
      teams.notifyMigrationStatus(row.host || `Host #${row.id}`, 'Hosts', status, by, null).catch(() => {});
    }
    res.json({ ok: true });
  } catch (e) { next(e); }
}

// ── BOMGAR VMs ────────────────────────────────────────────────────────────────
async function listBomgar(req, res, next) {
  try { res.json(await svc.listBomgarVMs(req.query)); } catch (e) { next(e); }
}
async function bomgarSummary(req, res, next) {
  try { res.json(await svc.bomgarSummary(req.query.project_id)); } catch (e) { next(e); }
}
async function patchBomgar(req, res, next) {
  try {
    const row = await svc.patchBomgarVM(req.params.id, req.body);
    if (!row) return res.status(404).json({ error: 'Record not found' });
    if (req.body.migration_status) {
      const by = req.user?.full_name || req.user?.email;
      teams.notifyMigrationStatus(row.vm || `VM #${row.id}`, 'Bomgar VMs', req.body.migration_status, by, row.primary_ip).catch(() => {});
    }
    res.json({ ok: true });
  } catch (e) { next(e); }
}

// ── SECURITY VMs ──────────────────────────────────────────────────────────────
async function listSecurity(req, res, next) {
  try { res.json(await svc.listSecurityVMs(req.query)); } catch (e) { next(e); }
}
async function securitySummary(req, res, next) {
  try { res.json(await svc.securitySummary(req.query.project_id)); } catch (e) { next(e); }
}
async function patchSecurity(req, res, next) {
  try {
    const row = await svc.patchSecurityVM(req.params.id, req.body);
    if (!row) return res.status(404).json({ error: 'Record not found' });
    if (req.body.migration_status) {
      const by = req.user?.full_name || req.user?.email;
      teams.notifyMigrationStatus(row.vm || `VM #${row.id}`, 'Security VMs', req.body.migration_status, by, row.primary_ip).catch(() => {});
    }
    res.json({ ok: true });
  } catch (e) { next(e); }
}

// ── STANDALONE ESXi ───────────────────────────────────────────────────────────
async function listStandalone(req, res, next) {
  try { res.json(await svc.listStandaloneVMs(req.query)); } catch (e) { next(e); }
}
async function standaloneSummary(req, res, next) {
  try { res.json(await svc.standaloneSummary(req.query.project_id)); } catch (e) { next(e); }
}
async function patchStandalone(req, res, next) {
  try {
    const row = await svc.patchStandaloneVM(req.params.id, req.body);
    if (!row) return res.status(404).json({ error: 'Record not found' });
    if (req.body.migration_status) {
      const by = req.user?.full_name || req.user?.email;
      teams.notifyMigrationStatus(row.vm || `VM #${row.id}`, 'Standalone ESXi', req.body.migration_status, by, row.primary_ip).catch(() => {});
    }
    res.json({ ok: true });
  } catch (e) { next(e); }
}

// ── DELETE SINGLE RECORD ──────────────────────────────────────────────────────
async function deleteBomgar(req, res, next) {
  try {
    const ok = await svc.deleteBomgarVM(req.params.id);
    if (!ok) return res.status(404).json({ error: 'Record not found' });
    res.status(204).end();
  } catch (e) { next(e); }
}

async function deleteSecurity(req, res, next) {
  try {
    const ok = await svc.deleteSecurityVM(req.params.id);
    if (!ok) return res.status(404).json({ error: 'Record not found' });
    res.status(204).end();
  } catch (e) { next(e); }
}

async function deleteStandalone(req, res, next) {
  try {
    const ok = await svc.deleteStandaloneVM(req.params.id);
    if (!ok) return res.status(404).json({ error: 'Record not found' });
    res.status(204).end();
  } catch (e) { next(e); }
}

async function deleteHost(req, res, next) {
  try {
    const ok = await svc.deleteHostRecord(req.params.id);
    if (!ok) return res.status(404).json({ error: 'Record not found' });
    res.status(204).end();
  } catch (e) { next(e); }
}

async function deleteCustomVM(req, res, next) {
  try {
    const ok = await svc.deleteCustomVMRecord(req.params.id);
    if (!ok) return res.status(404).json({ error: 'Record not found' });
    res.status(204).end();
  } catch (e) { next(e); }
}

// ── FILTER OPTIONS ────────────────────────────────────────────────────────────
async function filterOptions(req, res, next) {
  try { res.json(await svc.filterOptions(req.params.type, req.query.project_id)); } catch (e) { next(e); }
}

// ── CSV EXPORT ────────────────────────────────────────────────────────────────
async function csvExport(req, res, next) {
  try {
    const rows = await svc.exportCSV(req.params.type, req.query);
    const clean = rows.map(r => { const c = { ...r }; delete c.idrac_username_enc; delete c.idrac_password_enc; return c; });

    if (!clean.length) { res.setHeader('Content-Type', 'text/csv'); return res.send('No data'); }
    const header = Object.keys(clean[0]).join(',');
    const csvRows = clean.map(r =>
      Object.values(r).map(v => {
        if (v == null) return '';
        const s = String(v);
        return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s;
      }).join(',')
    );
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="migration-${req.params.type}.csv"`);
    res.send([header, ...csvRows].join('\n'));
  } catch (e) { next(e); }
}

// ── TEMPLATE DOWNLOAD ─────────────────────────────────────────────────────────
async function downloadTemplate(req, res, next) {
  try {
    const projectId = req.query.project_id || null;

    const HDR_FILL  = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A5F' } };
    const HDR_FONT  = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
    const SAMP_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF0F4FF' } };
    const NOTE_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF3CD' } };
    const BORDER    = { top: { style: 'thin', color: { argb: 'FFCCCCCC' } }, left: { style: 'thin', color: { argb: 'FFCCCCCC' } }, bottom: { style: 'thin', color: { argb: 'FFCCCCCC' } }, right: { style: 'thin', color: { argb: 'FFCCCCCC' } } };

    const wb = new ExcelJS.Workbook();
    wb.creator = 'Inventory IT';
    wb.created = new Date();

    function addSheet(name, columns, rows, notes) {
      const ws = wb.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 2 }] });
      ws.mergeCells(1, 1, 1, columns.length);
      const noteCell = ws.getCell('A1');
      noteCell.value = notes.join('   |   ');
      noteCell.fill  = NOTE_FILL;
      noteCell.font  = { italic: true, size: 10, color: { argb: 'FF856404' } };
      noteCell.alignment = { wrapText: true, vertical: 'middle' };
      ws.getRow(1).height = 28;

      const hdrRow = ws.getRow(2);
      columns.forEach((col, i) => {
        const cell = hdrRow.getCell(i + 1);
        cell.value = col.header; cell.fill = HDR_FILL; cell.font = HDR_FONT;
        cell.border = BORDER; cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
        ws.getColumn(i + 1).width = col.width || 20;
      });
      hdrRow.height = 36;

      rows.forEach((row, ri) => {
        const wsRow = ws.getRow(ri + 3);
        row.forEach((val, ci) => {
          const cell = wsRow.getCell(ci + 1);
          cell.value = val ?? ''; cell.fill = SAMP_FILL; cell.border = BORDER;
          cell.font = { size: 10 }; cell.alignment = { vertical: 'middle' };
        });
        wsRow.height = 20;
      });
      for (let r = rows.length + 3; r < rows.length + 13; r++) {
        const wsRow = ws.getRow(r);
        columns.forEach((_, ci) => {
          const cell = wsRow.getCell(ci + 1);
          cell.border = BORDER; cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFFFF' } };
        });
        wsRow.height = 20;
      }
      ws.autoFilter = { from: { row: 2, column: 1 }, to: { row: 2, column: columns.length } };
    }

    // Hosts
    addSheet('Hosts', [
      { header: 'vCenter', width: 22 }, { header: 'Host', width: 22 }, { header: 'Datacenter', width: 18 },
      { header: 'iDRAC', width: 18 }, { header: 'iDRAC username', width: 18 }, { header: 'iDRAC password', width: 18 },
      { header: 'iDRAC Virtual Console', width: 22 }, { header: 'Assigned License(s)', width: 22 },
      { header: 'ESX Version', width: 16 }, { header: 'Model', width: 22 }, { header: 'Serial Number', width: 18 },
      { header: 'BIOS Vendor', width: 16 }, { header: '# Min Cores', width: 12 }, { header: 'License Expiry Date', width: 20 },
      { header: 'Assigned To', width: 18 }, { header: 'No. of VMs to Migrate', width: 20 }, { header: 'Powered Off VMs', width: 16 },
      { header: 'Host Owner', width: 18 }, { header: 'VMs Vacate', width: 16 }, { header: 'Proxmox Install', width: 18 },
      { header: 'VM Migration Back to New Proxmox Host', width: 30 },
    ], [
      ['vcenter01.corp.local','esxi-host-01.corp.local','Bomgar-DC','192.168.1.10','idrac_user','idrac_pass','https://192.168.1.10/console','vSphere Standard','ESXi 7.0.3','Dell PowerEdge R740','SN-001122','Dell Inc.',16,'2026-12-31','John Smith',12,3,'Jane Doe','Completed','In Progress','Pending'],
    ], ['Sheet name must be exactly "Hosts"', 'License Expiry Date: YYYY-MM-DD', 'VMs Vacate / Proxmox Install / VM Migration Back: Pending | In Progress | Completed']);

    // Bomgar VMs
    addSheet('Bomgar VMs', [
      { header: 'VM', width: 28 }, { header: 'Powerstate', width: 14 }, { header: 'DNS Name', width: 28 },
      { header: 'CPUs', width: 8 }, { header: 'Memory', width: 12 }, { header: 'Active Memory', width: 14 },
      { header: 'NICs', width: 8 }, { header: 'Disks', width: 8 }, { header: 'Total Disk Capacity (MiB)', width: 22 },
      { header: 'Primary IP Address', width: 18 }, { header: 'Path', width: 36 }, { header: 'Datacenter', width: 18 },
      { header: 'Cluster', width: 18 }, { header: 'Host', width: 26 }, { header: 'OS (config file)', width: 28 },
      { header: 'OS (VMware Tools)', width: 28 }, { header: 'MIGRATION STATUS', width: 18 },
    ], [
      ['BOMGAR-WIN-001','poweredOn','bomgar-win-001.corp.local',4,8192,6144,1,1,51200,'10.0.1.50','/Bomgar-DC/vm/BOMGAR-WIN-001','Bomgar-DC','Bomgar-Cluster','esxi-host-01.corp.local','Microsoft Windows Server 2019 (64-bit)','Microsoft Windows Server 2019 (64-bit)','Not Started'],
    ], ['Sheet name must be exactly "Bomgar VMs"', 'Powerstate: poweredOn | poweredOff | suspended', 'Memory in MiB', 'MIGRATION STATUS: Not Started | In Progress | Completed | Blocked']);

    // Security VMs
    addSheet('Security VMs', [
      { header: 'VM', width: 28 }, { header: 'Primary IP Address', width: 18 }, { header: 'Mac Address', width: 20 },
      { header: 'Host', width: 26 }, { header: 'Powerstate', width: 14 }, { header: 'Guest State', width: 14 },
      { header: 'CPUs', width: 8 }, { header: 'Memory', width: 12 }, { header: 'NICs', width: 8 }, { header: 'Disks', width: 8 },
      { header: 'Total Disk Capacity (MiB)', width: 22 }, { header: 'OS (config file)', width: 28 },
      { header: 'OS (VMware Tools)', width: 28 }, { header: 'MIGRATION STATUS', width: 18 },
    ], [
      ['SEC-FIREWALL-01','10.0.2.10','00:50:56:aa:bb:01','esxi-sec-01.corp.local','poweredOn','running',2,4096,2,1,51200,'Other (32-bit)','Other (32-bit)','Not Started'],
    ], ['Sheet name must be exactly "Security VMs"', 'Guest State: running | notRunning | shuttingDown | resetting | standby | unknown', 'MIGRATION STATUS: Not Started | In Progress | Completed | Blocked']);

    // Standalone ESXi
    addSheet('Standalone ESXi', [
      { header: 'VM', width: 28 }, { header: 'Primary IP Address', width: 18 }, { header: 'Mac Address', width: 20 },
      { header: 'Host', width: 26 }, { header: 'Powerstate', width: 14 }, { header: 'Guest State', width: 14 },
      { header: 'CPUs', width: 8 }, { header: 'Memory', width: 12 }, { header: 'NICs', width: 8 }, { header: 'Disks', width: 8 },
      { header: 'Total Disk Capacity (MiB)', width: 22 }, { header: 'OS (config file)', width: 28 },
      { header: 'OS (VMware Tools)', width: 28 }, { header: 'MIGRATION STATUS', width: 18 },
    ], [
      ['STANDALONE-VM-01','192.168.10.50','00:50:56:cc:dd:01','192.168.10.1','poweredOn','running',4,8192,1,1,102400,'Microsoft Windows Server 2012 R2 (64-bit)','Microsoft Windows Server 2012 R2 (64-bit)','Not Started'],
    ], ['Sheet name must be exactly "Standalone ESXi"', 'These VMs are NOT managed by vCenter', 'MIGRATION STATUS: Not Started | In Progress | Completed | Blocked']);

    // Custom tabs for the project
    if (projectId) {
      const customTabs = await svc.getCustomTabs(projectId);
      for (const tab of customTabs) {
        if (!tab.enabled) continue;
        addSheet(tab.label, [
          { header: 'VM', width: 28 }, { header: 'Powerstate', width: 14 }, { header: 'Guest State', width: 14 },
          { header: 'Primary IP Address', width: 18 }, { header: 'Mac Address', width: 20 }, { header: 'DNS Name', width: 28 },
          { header: 'Host', width: 26 }, { header: 'CPUs', width: 8 }, { header: 'Memory', width: 12 },
          { header: 'Total Disk Capacity (MiB)', width: 22 }, { header: 'NICs', width: 8 }, { header: 'Disks', width: 8 },
          { header: 'OS (config file)', width: 28 }, { header: 'OS (VMware Tools)', width: 28 },
          { header: 'Datacenter', width: 18 }, { header: 'Cluster', width: 18 }, { header: 'Path', width: 36 },
          { header: 'MIGRATION STATUS', width: 18 },
        ], [], [`Sheet name must be exactly "${tab.label}"`, 'MIGRATION STATUS: Not Started | In Progress | Completed | Blocked']);
      }
    }

    const buffer = await wb.xlsx.writeBuffer();
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="Migration-Tracker-Template.xlsx"');
    res.setHeader('Content-Length', buffer.length);
    res.end(buffer);
  } catch (e) { next(e); }
}

// ── IMPORT ────────────────────────────────────────────────────────────────────
const uploadMiddleware = upload.single('file');

async function importPreview(req, res, next) {
  uploadMiddleware(req, res, async (err) => {
    if (err) return next(err);
    try {
      if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
      res.json({ ok: true, preview: await svc.previewImport(req.file.buffer, req.body?.project_id || null) });
    } catch (e) { next(e); }
  });
}

async function importConfirm(req, res, next) {
  uploadMiddleware(req, res, async (err) => {
    if (err) return next(err);
    try {
      if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
      const projectId = req.body?.project_id;
      if (!projectId) return res.status(400).json({ error: 'project_id is required' });
      const preserveStatus = req.body?.preserve_status === 'true' || req.body?.preserve_status === true;
      const counts = await svc.confirmImport(req.file.buffer, preserveStatus, projectId);
      res.json({ ok: true, counts });
    } catch (e) { next(e); }
  });
}

module.exports = {
  listProjects, getTabConfig, listCustomTabs,
  getFieldDefs, getFieldValues, setFieldValue,
  overview,
  listHosts, hostsSummary, getHostCredentials, patchHost, deleteHost,
  listBomgar, bomgarSummary, patchBomgar, deleteBomgar,
  listSecurity, securitySummary, patchSecurity, deleteSecurity,
  listStandalone, standaloneSummary, patchStandalone, deleteStandalone,
  listCustomVMs, customVMSummary, patchCustomVM, customFilterOptions, deleteCustomVM,
  filterOptions, csvExport,
  downloadTemplate,
  importPreview, importConfirm,
};
