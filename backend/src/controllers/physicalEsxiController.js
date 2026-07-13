const ExcelJS = require('exceljs');
const db = require('../config/db');
const svc = require('../services/physicalEsxiService');
const deptSvc = require('../services/departmentService');
const audit = require('../services/auditService');

const ENTITY = 'physical_esxi_server';
const SHEET_NAME = 'Physical & ESXi Servers';
const HEADER_COLOR = 'FF0F766E';
const TEMPLATE_FILE = 'physical-esxi-template.xlsx';
const EXPORT_FILE = 'physical-esxi-export.xlsx';
const EXAMPLE_PREFIX = 'PHYS';
const EXAMPLE_LOCATION = 'Data Center 1';
const EXAMPLE_NOTE = 'Example physical server';

const COLUMNS = [
  { key: 'vm_name',            header: 'Device Name *',      width: 22 },
  { key: 'os_hostname',        header: 'OS Hostname',         width: 22 },
  { key: 'ip_address',         header: 'Hosted IP *',         width: 18 },
  { key: 'hosted_ip',          header: 'Hosted IP (alt)',     width: 18 },
  { key: 'asset_type',         header: 'Asset Type',          width: 18 },
  { key: 'os_type',            header: 'OS Type',             width: 14 },
  { key: 'os_version',         header: 'OS Version',          width: 22 },
  { key: 'assigned_user',      header: 'Assigned User',       width: 18 },
  { key: 'department',         header: 'Department',          width: 16 },
  { key: 'business_purpose',   header: 'Business Purpose',    width: 28 },
  { key: 'server_status',      header: 'Server Status',       width: 16 },
  { key: 'location',           header: 'Location',            width: 16 },
  { key: 'serial_number',      header: 'Serial Number',       width: 18 },
  { key: 'server_model',       header: 'Server Model',        width: 22 },
  { key: 'cpu_cores',          header: 'CPU Cores',           width: 12 },
  { key: 'ram_gb',             header: 'RAM (GB)',            width: 12 },
  { key: 'total_disks',        header: 'Total Disks',         width: 14 },
  { key: 'ome_status',         header: 'OME Status',          width: 14 },
  { key: 'rack_number',        header: 'Rack Number',         width: 16 },
  { key: 'server_position',    header: 'Server Position',     width: 16 },
  { key: 'asset_tag',          header: 'Asset Tag',           width: 16 },
  { key: 'asset_username',     header: 'Asset Username',      width: 18 },
  { key: 'asset_password',     header: 'Asset Password',      width: 18 },
  { key: 'additional_remarks', header: 'Additional Remarks',  width: 28 },
  { key: 'mac_address',        header: 'MAC Address',         width: 18 },
  { key: 'idrac_enabled',      header: 'iDRAC Enabled',       width: 16 },
  { key: 'idrac_ip',           header: 'iDRAC IP',            width: 16 },
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
    res.status(201).json(asset);
  } catch (e) { next(e); }
}

async function update(req, res, next) {
  try {
    const asset = await svc.update(req.params.id, req.body, req.user.id);
    await audit.log({ user: req.user, action: 'UPDATE', entityType: ENTITY, entityId: asset.id, details: { vm_name: asset.vm_name }, ipAddress: req.ip });
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
      vm_name: `${EXAMPLE_PREFIX}-EX-01`, os_hostname: `${EXAMPLE_PREFIX.toLowerCase()}-ex-01.corp.local`,
      ip_address: '10.40.1.99', hosted_ip: '10.40.1.99',
      asset_type: 'Physical Server', os_type: 'Linux', os_version: 'Ubuntu 22.04',
      assigned_user: 'Example User', department: 'IT Team', business_purpose: EXAMPLE_NOTE,
      server_status: 'Active', location: EXAMPLE_LOCATION,
      serial_number: `${EXAMPLE_PREFIX}-001`, server_model: 'Dell PowerEdge R750',
      cpu_cores: 32, ram_gb: 128, total_disks: 4,
      ome_status: 'Active', rack_number: 'RACK-A1', server_position: 'U12',
      asset_tag: '', asset_username: 'svc_admin', asset_password: 'secret',
      additional_remarks: 'remove this row before import',
      idrac_enabled: 'FALSE', idrac_ip: '',
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

module.exports = { list, get, create, update, remove, tagStats, checkIp, downloadTemplate, exportAssets, importAssets, viewPassword };
