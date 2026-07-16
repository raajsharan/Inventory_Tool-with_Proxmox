const ExcelJS = require('exceljs');
const db = require('../config/db');
const svc     = require('../services/physicalEsxiService');
const deptSvc = require('../services/departmentService');
const audit   = require('../services/auditService');
const teams   = require('../services/teamsNotificationService');

const ENTITY = 'physical_esxi_server';
const SHEET_NAME = 'Physical & ESXi Servers';
const HEADER_COLOR = 'FF0F766E';
const TEMPLATE_FILE = 'physical-esxi-template.xlsx';
const EXPORT_FILE = 'physical-esxi-export.xlsx';
const EXAMPLE_PREFIX = 'PHYS';
const EXAMPLE_LOCATION = 'Data Center 1';
const EXAMPLE_NOTE = 'Example physical server';

// Columns match the Register Physical Server form exactly:
// Hardware Info → Rack Info → iDRAC
const COLUMNS = [
  { key: 'vm_name',            header: 'Device Name *',      width: 22 },
  { key: 'ip_address',         header: 'Hosted IP *',         width: 18 },
  { key: 'server_status',      header: 'Server Status',       width: 16 },
  { key: 'department',         header: 'Department',          width: 16 },
  { key: 'location',           header: 'Location',            width: 16 },
  { key: 'server_model',       header: 'Server Model',        width: 22 },
  { key: 'serial_number',      header: 'Serial Number',       width: 18 },
  { key: 'asset_type',         header: 'Asset Type',          width: 18 },
  { key: 'os_type',            header: 'OS Type',             width: 14 },
  { key: 'os_version',         header: 'OS Version',          width: 22 },
  { key: 'asset_username',     header: 'Asset Username',      width: 18 },
  { key: 'asset_password',     header: 'Asset Password',      width: 18 },
  { key: 'cpu_cores',          header: 'CPU Cores',           width: 12 },
  { key: 'ram_gb',             header: 'RAM (GB)',            width: 12 },
  { key: 'total_disks',        header: 'Total Disks',         width: 14 },
  { key: 'ome_status',         header: 'OME Status',          width: 14 },
  { key: 'rack_number',        header: 'Rack Number',         width: 16 },
  { key: 'server_position',    header: 'Server Position',     width: 16 },
  { key: 'additional_remarks', header: 'Additional Remarks',  width: 28 },
  { key: 'idrac_ip',           header: 'iDRAC IP',            width: 16 },
  { key: 'idrac_enabled',      header: 'iDRAC Enabled',       width: 16 },
];

const IP_RE = /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;

function parseBool(v) {
  if (v === true || v === false) return v;
  if (v === null || v === undefined || v === '') return false;
  const s = String(v).trim().toLowerCase();
  return ['true','yes','y','1'].includes(s);
}

function styleHeader(ws) {
  const row = ws.getRow(1);
  row.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  row.alignment = { vertical: 'middle', horizontal: 'center' };
  row.eachCell((cell) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_COLOR } };
    cell.border = { bottom: { style: 'thin', color: { argb: 'FF999999' } } };
  });
  row.height = 22;
}

async function list(req, res, next) {
  try {
    const result = await svc.list({
      search: req.query.search,
      osType: req.query.osType,
      serverStatus: req.query.serverStatus,
      location: req.query.location,
      serverModel: req.query.serverModel,
      page: Number(req.query.page) || 1,
      pageSize: Math.min(Number(req.query.pageSize) || 20, 200),
      sortBy: req.query.sortBy,
      sortDir: req.query.sortDir,
    });
    res.json(result);
  } catch (e) { next(e); }
}

async function get(req, res, next) {
  try { res.json(await svc.get(req.params.id)); } catch (e) { next(e); }
}

async function create(req, res, next) {
  try {
    const asset = await svc.create(req.body, req.user.id);
    await audit.log({ user: req.user, action: 'CREATE', entityType: ENTITY, entityId: asset.id, details: { vm_name: asset.vm_name }, ipAddress: req.ip });
    teams.notifyNewAsset(asset, 'physical_esxi_servers', req.user?.full_name || req.user?.email).catch(() => {});
    res.status(201).json(asset);
  } catch (e) { next(e); }
}

async function update(req, res, next) {
  try {
    const asset = await svc.update(req.params.id, req.body, req.user.id);
    await audit.log({ user: req.user, action: 'UPDATE', entityType: ENTITY, entityId: asset.id, details: { vm_name: asset.vm_name }, ipAddress: req.ip });
    teams.notifyAssetUpdate(asset, 'physical_esxi_servers', req.user?.full_name || req.user?.email).catch(() => {});
    res.json(asset);
  } catch (e) { next(e); }
}

async function remove(req, res, next) {
  try {
    const { verifyCurrentPassword } = require('../utils/verifyPassword');
    await verifyCurrentPassword(req.user.id, req.body?.password);
    await svc.remove(req.params.id, req.user.id);
    await audit.log({ user: req.user, action: 'DELETE', entityType: ENTITY, entityId: req.params.id, ipAddress: req.ip });
    res.status(204).end();
  } catch (e) { next(e); }
}

async function tagStats(req, res, next) {
  try {
    res.json(await svc.tagStats(req.query.department));
  } catch (e) { next(e); }
}

async function viewPassword(req, res, next) {
  try {
    const password = await svc.viewPassword(req.params.id);
    await audit.log({ user: req.user, action: 'VIEW_PASSWORD', entityType: 'physical_esxi', entityId: req.params.id, ipAddress: req.ip });
    res.json({ password: password || '' });
  } catch (e) { next(e); }
}

async function checkIp(req, res, next) {
  try {
    const ip = String(req.query.ip || '').trim();
    if (!ip) return res.json({ used: false, conflictTable: null });
    const conflict = await deptSvc.isIpUsedAnywhere(ip, {
      excludeTable: req.query.excludeTable || undefined,
      excludeId: req.query.excludeId || undefined,
    });
    res.json({ used: !!conflict, conflictTable: conflict });
  } catch (e) { next(e); }
}

async function downloadTemplate(_req, res, next) {
  try {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet(SHEET_NAME);
    ws.columns = COLUMNS.map(c => ({ header: c.header, key: c.key, width: c.width }));
    styleHeader(ws);

    ws.addRow({
      vm_name: `${EXAMPLE_PREFIX}-EX-01`, ip_address: '10.40.1.99',
      server_status: 'Active', department: 'IT Team', location: EXAMPLE_LOCATION,
      server_model: 'Dell PowerEdge R750', serial_number: `${EXAMPLE_PREFIX}-001`,
      asset_type: 'Physical Server', os_type: 'Linux', os_version: 'Ubuntu 22.04',
      asset_username: 'svc_admin', asset_password: 'secret',
      cpu_cores: 32, ram_gb: 128, total_disks: 4, ome_status: 'Active',
      rack_number: 'RACK-A1', server_position: 'U12',
      additional_remarks: 'remove this row before import',
      idrac_ip: '', idrac_enabled: 'FALSE',
    });

    const ws2 = wb.addWorksheet('Department Tag Ranges');
    ws2.getColumn(1).width = 38;
    ws2.getColumn(2).width = 22;
    ws2.getColumn(3).width = 10;
    ws2.getColumn(4).width = 10;
    ws2.addRow(['Department', 'Asset Tag Range', 'Min', 'Max']);
    const hdr = ws2.getRow(1);
    hdr.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    hdr.eachCell((c) => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_COLOR } }; });
    hdr.height = 22;
    const ranges = await deptSvc.list({ activeOnly: true });
    for (const r of ranges) {
      ws2.addRow([
        r.name,
        `${String(r.min_tag).padStart(4, '0')}–${String(r.max_tag).padStart(4, '0')}`,
        r.min_tag,
        r.max_tag,
      ]);
    }

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${TEMPLATE_FILE}"`);
    await wb.xlsx.write(res);
    res.end();
  } catch (e) { next(e); }
}

async function exportAssets(req, res, next) {
  try {
    const { items } = await svc.list({
      search: req.query.search,
      osType: req.query.osType,
      serverStatus: req.query.serverStatus,
      location: req.query.location,
      serverModel: req.query.serverModel,
      page: 1, pageSize: 100000,
    });
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet(SHEET_NAME);
    ws.columns = COLUMNS.map(c => ({ header: c.header.replace(' *', ''), key: c.key, width: c.width }));
    styleHeader(ws);
    for (const a of items) {
      ws.addRow({
        ...a,
        asset_password: a.hasPassword ? '••••••' : '',
        idrac_enabled: a.idrac_enabled ? 'TRUE' : 'FALSE',
      });
    }
    await audit.log({ user: req.user, action: 'EXPORT', entityType: ENTITY, ipAddress: req.ip });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${EXPORT_FILE}"`);
    await wb.xlsx.write(res);
    res.end();
  } catch (e) { next(e); }
}

async function importAssets(req, res, next) {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(req.file.buffer);
    const ws = wb.getWorksheet(SHEET_NAME) || wb.worksheets[0];
    if (!ws) return res.status(400).json({ error: 'No worksheet found' });

    const headerMap = {};
    ws.getRow(1).eachCell((cell, col) => {
      const text = String(cell.value || '').replace(' *', '').trim().toLowerCase();
      const match = COLUMNS.find(c => c.header.replace(' *', '').trim().toLowerCase() === text);
      if (match) headerMap[col] = match.key;
    });

    const total = Math.max(0, ws.rowCount - 1);
    const successes = [];
    const failures = [];
    const seen = { vm: new Set(), ip: new Set(), tag: new Set() };

    for (let i = 2; i <= ws.rowCount; i++) {
      const r = {};
      ws.getRow(i).eachCell((cell, col) => {
        const k = headerMap[col];
        if (!k) return;
        r[k] = cell.value && typeof cell.value === 'object' && 'text' in cell.value ? cell.value.text : cell.value;
        if (typeof r[k] === 'string') r[k] = r[k].trim();
      });
      if (!Object.keys(r).length) continue;
      r.idrac_enabled = parseBool(r.idrac_enabled);

      const errs = [];
      if (!r.vm_name)    errs.push('VM Name is required');
      if (!r.ip_address) errs.push('IP Address is required');
      if (r.ip_address && !IP_RE.test(String(r.ip_address).trim())) errs.push('Invalid IP Address');
      if (r.vm_name && seen.vm.has(r.vm_name)) errs.push('duplicate VM Name in file');
      if (r.ip_address && seen.ip.has(r.ip_address)) errs.push('duplicate IP Address in file');
      if (r.asset_tag && seen.tag.has(r.asset_tag)) errs.push('duplicate Asset Tag in file');
      if (errs.length) { failures.push({ row: i, errors: errs, data: r }); continue; }

      seen.vm.add(r.vm_name);
      seen.ip.add(r.ip_address);
      if (r.asset_tag) seen.tag.add(r.asset_tag);

      try {
        const created = await svc.create({ ...r, assetPassword: r.asset_password }, req.user?.id);
        successes.push({ row: i, id: created.id, vm_name: created.vm_name });
      } catch (e) {
        failures.push({ row: i, errors: [e.message], details: e.details });
      }
    }

    await db.query(
      `INSERT INTO import_logs (filename, total_rows, success_rows, failed_rows, error_details, imported_by)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [req.file.originalname || `${ENTITY}-upload.xlsx`, total, successes.length, failures.length, JSON.stringify(failures), req.user?.id || null]
    );
    await audit.log({ user: req.user, action: 'IMPORT', entityType: ENTITY, details: { total, success: successes.length, failed: failures.length }, ipAddress: req.ip });
    res.json({ total, success: successes.length, failed: failures.length, failures, successes });
  } catch (e) { next(e); }
}

// ── Sync ESXi hosts + Proxmox VE hosts into Physical & ESXi Servers ──────────
async function syncFromDiscovery(req, res, next) {
  try {
    const userId = req.user?.id || null;

    // IPs already registered — skip these
    const { rows: existing } = await db.query(
      `SELECT ip_address FROM physical_esxi_servers WHERE deleted_at IS NULL AND decommissioned_at IS NULL`
    );
    const existingIps = new Set(existing.map(r => r.ip_address));

    let created = 0, skipped = 0;
    const errors = [];

    async function insertOne(fields) {
      const ip = String(fields.ip_address || '').trim();
      if (!IP_RE.test(ip)) {
        throw new Error(`Invalid IP address format: ${fields.ip_address}`);
      }
      const conflictTable = await deptSvc.isIpUsedAnywhere(ip);
      if (conflictTable) {
        throw new Error(`IP address already used in another inventory (${conflictTable})`);
      }
      const cols = Object.keys(fields);
      const vals = Object.values(fields);
      const ph   = cols.map((_, i) => `$${i + 1}`).join(', ');
      await db.query(
        `INSERT INTO physical_esxi_servers (${cols.join(', ')}) VALUES (${ph})`,
        vals
      );
    }

    // ── VMware ESXi / vCenter host entries ────────────────────────────────
    const { rows: esxiHosts } = await db.query(
      `SELECT host, last_discovery_at FROM vmware_hosts ORDER BY created_at`
    );

    for (const h of esxiHosts) {
      const ip   = h.host;
      const name = h.host;
      if (!ip || !name) { skipped++; continue; }
      if (existingIps.has(ip)) { skipped++; continue; }
      try {
        await insertOne({
          vm_name:            name,
          ip_address:         ip,
          server_status:      'Active',
          additional_remarks: 'Synced from VMware ESXi / vCenter host',
          created_by:         userId,
          updated_by:         userId,
        });
        existingIps.add(ip);
        created++;
      } catch (e) {
        errors.push({ source: 'vmware_host', name, ip, error: e.message });
        skipped++;
      }
    }

    // ── Proxmox VE host entries ────────────────────────────────────────────
    const { rows: proxmoxHosts } = await db.query(
      `SELECT host, host_type, last_discovery_at FROM proxmox_hosts ORDER BY created_at`
    );

    for (const h of proxmoxHosts) {
      const ip   = h.host;
      const name = h.host;
      if (!ip || !name) { skipped++; continue; }
      if (existingIps.has(ip)) { skipped++; continue; }
      try {
        await insertOne({
          vm_name:            name,
          ip_address:         ip,
          server_status:      'Active',
          additional_remarks: `Synced from Proxmox ${h.host_type?.toUpperCase() || 'VE'} host`,
          created_by:         userId,
          updated_by:         userId,
        });
        existingIps.add(ip);
        created++;
      } catch (e) {
        errors.push({ source: 'proxmox_host', name, ip, error: e.message });
        skipped++;
      }
    }

    await audit.log({
      user: req.user, action: 'SYNC_FROM_DISCOVERY', entityType: ENTITY,
      details: { esxiHosts: esxiHosts.length, proxmoxHosts: proxmoxHosts.length, created, skipped },
      ipAddress: req.ip,
    });

    res.json({
      esxiTotal:    esxiHosts.length,
      proxmoxTotal: proxmoxHosts.length,
      created,
      skipped,
      errors,
    });
  } catch (e) { next(e); }
}

module.exports = { list, get, create, update, remove, tagStats, checkIp, downloadTemplate, exportAssets, importAssets, viewPassword, syncFromDiscovery };
