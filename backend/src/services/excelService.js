const ExcelJS = require('exceljs');
const db = require('../config/db');
const assetSvc = require('./assetService');
const deptSvc = require('./departmentService');

const COLUMNS = [
  { key: 'vm_name',                  header: 'VM Name *',                width: 22 },
  { key: 'os_hostname',              header: 'OS Hostname',              width: 22 },
  { key: 'ip_address',               header: 'IP Address *',             width: 18 },
  { key: 'asset_type',               header: 'Asset Type',               width: 18 },
  { key: 'os_type',                  header: 'OS Type',                  width: 14 },
  { key: 'os_version',               header: 'OS Version',               width: 22 },
  { key: 'assigned_user',            header: 'Assigned User',            width: 18 },
  { key: 'department',               header: 'Department',               width: 16 },
  { key: 'business_purpose',         header: 'Business Purpose',         width: 28 },
  { key: 'server_status',            header: 'Server Status',            width: 16 },
  { key: 'patching_type',            header: 'Patching Type',            width: 14 },
  { key: 'server_patch_type',        header: 'Server Patch Type',        width: 18 },
  { key: 'patching_schedule',        header: 'Patching Schedule',        width: 18 },
  { key: 'location',                 header: 'Location',                 width: 16 },
  { key: 'eol_status',                header: 'EOL Status',              width: 16 },
  { key: 'serial_number',            header: 'Serial Number',            width: 18 },
  { key: 'ome_status',               header: 'OME Status',               width: 14 },
  { key: 'hosted_ip',                header: 'Hosted IP',                width: 16 },
  { key: 'asset_tag',                header: 'Asset Tag',                width: 16 },
  { key: 'asset_username',           header: 'Asset Username',           width: 18 },
  { key: 'asset_password',           header: 'Asset Password',           width: 18 },
  { key: 'additional_remarks',       header: 'Additional Remarks',       width: 28 },
  { key: 'manage_engine_installed',  header: 'ManageEngine Installed',   width: 22 },
  { key: 'tenable_installed',        header: 'Tenable Installed',        width: 20 },
  { key: 'idrac_enabled',            header: 'iDRAC Enabled',            width: 16 },
  { key: 'idrac_ip',                 header: 'iDRAC IP',                 width: 16 },
  { key: 'mac_address',              header: 'MAC Address',              width: 18 },
];

function styleHeader(ws) {
  const row = ws.getRow(1);
  row.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  row.alignment = { vertical: 'middle', horizontal: 'center' };
  row.eachCell((cell) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F3A8A' } };
    cell.border = { bottom: { style: 'thin', color: { argb: 'FF999999' } } };
  });
  row.height = 22;
}

async function buildTemplate() {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Assets');
  ws.columns = COLUMNS.map(c => ({ header: c.header, key: c.key, width: c.width }));
  styleHeader(ws);

  ws.addRow({
    vm_name: 'PROD-WEB-EX', os_hostname: 'prod-web-ex.corp.local', ip_address: '10.10.1.99',
    asset_type: 'Virtual Server', os_type: 'Linux', os_version: 'Ubuntu 22.04',
    assigned_user: 'Example User', department: 'IT', business_purpose: 'Example asset',
    server_status: 'Active', patching_type: 'Automatic', server_patch_type: 'Production',
    patching_schedule: 'Monthly', location: 'Data Center 1', eol_status: 'Supported',
    serial_number: 'SN-EX-001', ome_status: 'OK', hosted_ip: '', asset_tag: 'AT-EX-001',
    asset_username: 'svc_admin', asset_password: 'secret', additional_remarks: 'remove this row before import',
    manage_engine_installed: 'TRUE', tenable_installed: 'TRUE',
    idrac_enabled: 'FALSE', idrac_ip: '', mac_address: '',
  });

  const ws2 = wb.addWorksheet('Allowed Values');
  ws2.columns = [{ header: 'Category', width: 22 }, { header: 'Value', width: 32 }];
  styleHeader(ws2);
  const { rows } = await db.query(
    `SELECT category, value FROM dropdown_master WHERE is_active = TRUE ORDER BY category, sort_order`
  );
  rows.forEach(r => ws2.addRow([r.category, r.value]));

  const ws3 = wb.addWorksheet('Department Tag Ranges');
  ws3.getColumn(1).width = 38;
  ws3.getColumn(2).width = 22;
  ws3.getColumn(3).width = 10;
  ws3.getColumn(4).width = 10;
  ws3.mergeCells('A1:D1');
  ws3.getCell('A1').value =
    "Asset Tag must contain a number within the selected Department's range. Ranges may overlap across teams.";
  ws3.getCell('A1').font = { italic: true, color: { argb: 'FF555555' } };
  ws3.addRow(['Department', 'Asset Tag Range', 'Min', 'Max']);
  const hdrRow = ws3.getRow(2);
  hdrRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  hdrRow.alignment = { vertical: 'middle', horizontal: 'center' };
  hdrRow.eachCell((cell) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F3A8A' } };
    cell.border = { bottom: { style: 'thin', color: { argb: 'FF999999' } } };
  });
  hdrRow.height = 22;
  const ranges = await deptSvc.list({ activeOnly: true });
  for (const r of ranges) {
    ws3.addRow([
      r.name,
      `${String(r.min_tag).padStart(4, '0')}–${String(r.max_tag).padStart(4, '0')}`,
      r.min_tag,
      r.max_tag,
    ]);
  }

  return wb;
}

async function exportAssets(filters) {
  const { items } = await assetSvc.list({ ...filters, page: 1, pageSize: 100000 });
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Assets');
  ws.columns = COLUMNS.map(c => ({ header: c.header.replace(' *', ''), key: c.key, width: c.width }));
  styleHeader(ws);
  for (const a of items) {
    ws.addRow({
      ...a,
      asset_password: a.hasPassword ? '••••••' : '',
      manage_engine_installed: a.manage_engine_installed ? 'TRUE' : 'FALSE',
      tenable_installed: a.tenable_installed ? 'TRUE' : 'FALSE',
      idrac_enabled: a.idrac_enabled ? 'TRUE' : 'FALSE',
    });
  }
  return wb;
}

function parseBool(v) {
  if (v === true || v === false) return v;
  if (v === null || v === undefined || v === '') return false;
  const s = String(v).trim().toLowerCase();
  return ['true','yes','y','1'].includes(s);
}

const IP_RE = /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;

function validateRow(r) {
  const errors = [];
  if (!r.vm_name)    errors.push('VM Name is required');
  if (!r.ip_address) errors.push('IP Address is required');
  if (r.ip_address && !IP_RE.test(String(r.ip_address).trim())) errors.push('Invalid IP Address');
  return errors;
}

async function importWorkbook(buffer, user) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const ws = wb.getWorksheet('Assets') || wb.worksheets[0];
  if (!ws) throw new Error('No worksheet found');

  const headerMap = {};
  ws.getRow(1).eachCell((cell, col) => {
    const text = String(cell.value || '').replace(' *', '').trim();
    const match = COLUMNS.find(c => c.header.replace(' *', '').trim().toLowerCase() === text.toLowerCase());
    if (match) headerMap[col] = match.key;
  });

  const total = ws.rowCount - 1;
  const successes = [];
  const failures = [];
  const seenInSheet = { vm: new Set(), ip: new Set(), tag: new Set() };

  for (let i = 2; i <= ws.rowCount; i++) {
    const r = {};
    ws.getRow(i).eachCell((cell, col) => {
      const k = headerMap[col];
      if (!k) return;
      r[k] = cell.value && typeof cell.value === 'object' && 'text' in cell.value ? cell.value.text : cell.value;
      if (typeof r[k] === 'string') r[k] = r[k].trim();
    });
    if (!Object.keys(r).length) continue;

    r.manage_engine_installed = parseBool(r.manage_engine_installed);
    r.tenable_installed = parseBool(r.tenable_installed);
    r.idrac_enabled = parseBool(r.idrac_enabled);

    const errors = validateRow(r);
    if (r.ip_address && seenInSheet.ip.has(r.ip_address)) errors.push('duplicate IP Address in file');
    if (r.asset_tag && seenInSheet.tag.has(r.asset_tag)) errors.push('duplicate Asset Tag in file');

    if (errors.length) { failures.push({ row: i, errors, data: r }); continue; }

    seenInSheet.ip.add(r.ip_address);
    if (r.asset_tag) seenInSheet.tag.add(r.asset_tag);

    try {
      const created = await assetSvc.create({ ...r, assetPassword: r.asset_password }, user?.id);
      successes.push({ row: i, id: created.id, vm_name: created.vm_name });
    } catch (e) {
      failures.push({ row: i, errors: [e.message], details: e.details });
    }
  }

  await db.query(
    `INSERT INTO import_logs (filename, total_rows, success_rows, failed_rows, error_details, imported_by)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    ['upload.xlsx', total, successes.length, failures.length, JSON.stringify(failures), user?.id || null]
  );

  return { total, success: successes.length, failed: failures.length, failures, successes };
}

module.exports = { buildTemplate, exportAssets, importWorkbook };
