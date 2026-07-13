const db = require('../config/db');
const ApiError = require('../utils/ApiError');

const ASSET_FIELDS = [
  { key: 'vm_name', label: 'VM Name', type: 'string' },
  { key: 'os_hostname', label: 'OS Hostname', type: 'string' },
  { key: 'ip_address', label: 'IP Address', type: 'string' },
  { key: 'asset_type', label: 'Asset Type', type: 'string' },
  { key: 'os_type', label: 'OS Type', type: 'string' },
  { key: 'os_version', label: 'OS Version', type: 'string' },
  { key: 'assigned_user', label: 'Assigned User', type: 'string' },
  { key: 'department', label: 'Department', type: 'string' },
  { key: 'business_purpose', label: 'Business Purpose', type: 'string' },
  { key: 'server_status', label: 'Server Status', type: 'string' },
  { key: 'patching_type', label: 'Patching Type', type: 'string' },
  { key: 'server_patch_type', label: 'Server Patch Type', type: 'string' },
  { key: 'patching_schedule', label: 'Patching Schedule', type: 'string' },
  { key: 'location', label: 'Location', type: 'string' },
  { key: 'eol_status', label: 'EOL Status', type: 'string' },
  { key: 'serial_number', label: 'Serial Number', type: 'string' },
  { key: 'ome_status', label: 'OME Status', type: 'string' },
  { key: 'hosted_ip', label: 'Hosted IP', type: 'string' },
  { key: 'asset_tag', label: 'Asset Tag', type: 'string' },
  { key: 'asset_username', label: 'Asset Username', type: 'string' },
  { key: 'additional_remarks', label: 'Additional Remarks', type: 'string' },
  { key: 'manage_engine_installed', label: 'ManageEngine Installed', type: 'boolean' },
  { key: 'tenable_installed', label: 'Tenable Installed', type: 'boolean' },
  { key: 'idrac_enabled', label: 'iDRAC Enabled', type: 'boolean' },
  { key: 'created_at', label: 'Date Added', type: 'date' },
  { key: 'updated_at', label: 'Last Modified', type: 'date' },
];

// physical_esxi_servers had patching_type/eol_status/manage_engine_installed/
// tenable_installed/server_patch_type/patching_schedule dropped; replaced with
// hardware/rack fields.
const PHYS_ESXI_FIELDS = [
  { key: 'vm_name', label: 'Device Name', type: 'string' },
  { key: 'os_hostname', label: 'OS Hostname', type: 'string' },
  { key: 'ip_address', label: 'Hosted IP', type: 'string' },
  { key: 'hosted_ip', label: 'Hosted IP (alt)', type: 'string' },
  { key: 'asset_type', label: 'Asset Type', type: 'string' },
  { key: 'os_type', label: 'OS Type', type: 'string' },
  { key: 'os_version', label: 'OS Version', type: 'string' },
  { key: 'assigned_user', label: 'Assigned User', type: 'string' },
  { key: 'department', label: 'Department', type: 'string' },
  { key: 'business_purpose', label: 'Business Purpose', type: 'string' },
  { key: 'server_status', label: 'Server Status', type: 'string' },
  { key: 'location', label: 'Location', type: 'string' },
  { key: 'serial_number', label: 'Serial Number', type: 'string' },
  { key: 'server_model', label: 'Server Model', type: 'string' },
  { key: 'cpu_cores', label: 'CPU Cores', type: 'number' },
  { key: 'ram_gb', label: 'RAM (GB)', type: 'number' },
  { key: 'total_disks', label: 'Total Disks', type: 'number' },
  { key: 'ome_status', label: 'OME Status', type: 'string' },
  { key: 'rack_number', label: 'Rack Number', type: 'string' },
  { key: 'server_position', label: 'Server Position', type: 'string' },
  { key: 'asset_tag', label: 'Asset Tag', type: 'string' },
  { key: 'asset_username', label: 'Asset Username', type: 'string' },
  { key: 'additional_remarks', label: 'Additional Remarks', type: 'string' },
  { key: 'mac_address', label: 'MAC Address', type: 'string' },
  { key: 'idrac_enabled', label: 'iDRAC Enabled', type: 'boolean' },
  { key: 'idrac_ip', label: 'iDRAC IP', type: 'string' },
  { key: 'created_at', label: 'Date Added', type: 'date' },
  { key: 'updated_at', label: 'Last Modified', type: 'date' },
];

async function sources() {
  const { rows: pages } = await db.query(
    `SELECT cp.id, cp.slug, cp.name, COALESCE(json_agg(cpf.* ORDER BY cpf.sort_order) FILTER (WHERE cpf.id IS NOT NULL), '[]') AS fields
       FROM custom_pages cp
       LEFT JOIN custom_page_fields cpf ON cpf.page_id = cp.id
      WHERE cp.is_active = TRUE
      GROUP BY cp.id
      ORDER BY cp.created_at ASC`
  );
  const customSources = pages.map(p => ({
    key: `custom:${p.slug}`,
    label: p.name,
    kind: 'custom_page',
    pageId: p.id,
    fields: (p.fields || []).map(f => ({
      key: f.field_key,
      label: f.label,
      type: f.field_type === 'number' ? 'number' : (f.field_type === 'toggle' ? 'boolean' : (f.field_type === 'date' ? 'date' : 'string')),
    })),
  }));

  return [
    { key: 'assets',                label: 'Asset Inventory',          kind: 'table', table: 'assets',                fields: ASSET_FIELDS },
    { key: 'beijing_assets',        label: 'Beijing Asset Inventory',  kind: 'table', table: 'beijing_assets',        fields: ASSET_FIELDS },
    { key: 'ext_assets',            label: 'Ext. Asset Inventory',     kind: 'table', table: 'ext_assets',            fields: ASSET_FIELDS },
    { key: 'physical_esxi_servers', label: 'Physical & ESXi Servers',  kind: 'table', table: 'physical_esxi_servers', fields: PHYS_ESXI_FIELDS },
    ...customSources,
  ];
}

const OPS = {
  eq:   { sql: '= $X', args: 1 },
  ne:   { sql: '<> $X', args: 1 },
  like: { sql: 'ILIKE $X', args: 1, transform: v => `%${v}%` },
  gt:   { sql: '> $X', args: 1 },
  gte:  { sql: '>= $X', args: 1 },
  lt:   { sql: '< $X', args: 1 },
  lte:  { sql: '<= $X', args: 1 },
  isnull: { sql: 'IS NULL', args: 0 },
  notnull: { sql: 'IS NOT NULL', args: 0 },
};

function buildAssetWhere(filters, params, fields = ASSET_FIELDS) {
  const where = [];
  for (const f of filters || []) {
    const op = OPS[f.op];
    if (!op) continue;
    const col = fields.find(a => a.key === f.field);
    if (!col) continue;
    if (op.args === 0) {
      where.push(`${col.key} ${op.sql}`);
    } else {
      const val = op.transform ? op.transform(f.value) : f.value;
      params.push(val);
      where.push(`${col.key} ${op.sql.replace('$X', '$' + params.length)}`);
    }
  }
  return where.length ? `WHERE ${where.join(' AND ')}` : '';
}

async function run({ source, columns = [], filters = [], limit = 5000 }) {
  const all = await sources();
  const src = all.find(s => s.key === source);
  if (!src) throw new ApiError(400, 'Unknown report source');
  const cap = Math.min(Number(limit) || 5000, 50000);

  if (src.kind === 'table') {
    const tableFields = src.fields;
    const selectableCols = new Set(tableFields.map(f => f.key));
    const cols = (columns.length ? columns : tableFields.map(f => f.key)).filter(c => selectableCols.has(c));
    if (!cols.length) cols.push('id');
    const params = [];
    const whereSql = buildAssetWhere(filters, params, tableFields);
    const { rows } = await db.query(
      `SELECT ${cols.join(',')} FROM ${src.table} ${whereSql} ORDER BY created_at DESC LIMIT ${cap}`,
      params
    );
    return { columns: cols.map(c => src.fields.find(f => f.key === c) || { key: c, label: c, type: 'string' }), rows };
  }

  // custom_page
  const fieldMap = new Map(src.fields.map(f => [f.key, f]));
  const selected = (columns.length ? columns : src.fields.map(f => f.key)).filter(c => fieldMap.has(c));
  const params = [src.pageId];
  const where = ['page_id = $1'];
  for (const f of filters || []) {
    const meta = fieldMap.get(f.field);
    if (!meta) continue;
    const op = OPS[f.op];
    if (!op) continue;
    if (op.args === 0) {
      where.push(`(data->>'${f.field}') ${op.sql}`);
    } else {
      const val = op.transform ? op.transform(f.value) : f.value;
      params.push(String(val));
      where.push(`(data->>'${f.field}') ${op.sql.replace('$X', '$' + params.length)}`);
    }
  }
  const { rows } = await db.query(
    `SELECT id, data, created_at, updated_at FROM custom_page_records
      WHERE ${where.join(' AND ')}
      ORDER BY created_at DESC
      LIMIT ${cap}`,
    params
  );
  const flat = rows.map(r => {
    const o = { id: r.id, created_at: r.created_at, updated_at: r.updated_at };
    for (const c of selected) o[c] = r.data?.[c] ?? null;
    return o;
  });
  return {
    columns: selected.map(c => fieldMap.get(c)),
    rows: flat,
  };
}

module.exports = { sources, run };
