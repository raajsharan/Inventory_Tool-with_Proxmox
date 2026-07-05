const pg = require('pg');

const COLUMN_ALIASES = {
  vm_name:               ['vm name', 'vmname', 'name', 'hostname (vm)', 'vm_name'],
  os_hostname:           ['os hostname', 'hostname', 'host name', 'os_hostname'],
  ip_address:            ['ip address', 'ip', 'ipv4', 'ip_address'],
  asset_type:            ['asset type', 'type', 'asset_type'],
  os_type:               ['os type', 'operating system', 'os', 'os_type'],
  os_version:            ['os version', 'version', 'os_version'],
  assigned_user:         ['assigned user', 'owner', 'assigned to', 'assigned_user'],
  department:            ['department', 'dept', 'team'],
  business_purpose:      ['business purpose', 'purpose', 'business_purpose'],
  server_status:         ['server status', 'status', 'server_status'],
  patching_type:         ['patching type', 'patching_type'],
  server_patch_type:     ['server patch type', 'server_patch_type'],
  patching_schedule:     ['patching schedule', 'patch schedule', 'patching_schedule'],
  location:              ['location', 'site', 'data center', 'datacenter'],
  eol_status:            ['eol status', 'eol', 'end of life', 'eol_status'],
  serial_number:         ['serial number', 'serial', 'sn', 'serial_number'],
  ome_status:            ['ome status', 'ome', 'ome_status'],
  hosted_ip:             ['hosted ip', 'hosted_ip'],
  asset_tag:             ['asset tag', 'tag', 'asset_tag'],
  asset_username:        ['asset username', 'username', 'asset_username'],
  asset_password:        ['asset password', 'password', 'asset_password', 'asset_password_encrypted'],
  additional_remarks:    ['additional remarks', 'remarks', 'notes', 'comments', 'additional_remarks'],
  manage_engine_installed: ['manageengine installed', 'manage engine installed', 'manageengine', 'me', 'manage_engine_installed'],
  tenable_installed:     ['tenable installed', 'tenable', 'tenable_installed'],
  idrac_enabled:         ['idrac enabled', 'idrac', 'idrac_enabled'],
};

function normalize(s) {
  return String(s || '').replace(/[_\-\s]+/g, ' ').trim().toLowerCase();
}

async function withClient(creds, fn) {
  // pg's val() uses a truthy check so '' is falsy → falls through to null default →
  // SASL throws "client password must be a string".
  // Fix: bypass val() entirely by patching client.password after construction.
  const password = (creds.password != null && creds.password !== '') ? String(creds.password) : null;

  console.log(`[dbImport] withClient host=${creds.host} user=${creds.user} db=${creds.database} pwType=${typeof password} pwLen=${password !== null ? password.length : 'null'}`);

  const client = new pg.Client({
    host:                    creds.host,
    port:                    Number(creds.port) || 5432,
    database:                creds.database,
    user:                    creds.user,
    ssl:                     creds.ssl ? { rejectUnauthorized: false } : false,
    connectionTimeoutMillis: 10000,
  });

  // Patch password directly onto client instance and its connectionParameters,
  // bypassing pg's internal val() truthy-check that drops empty/falsy passwords.
  if (password !== null) {
    Object.defineProperty(client, 'password', {
      configurable: true, enumerable: false, writable: true, value: password,
    });
    Object.defineProperty(client.connectionParameters, 'password', {
      configurable: true, enumerable: false, writable: true, value: password,
    });
  }

  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

async function testConnection(creds) {
  return withClient(creds, async (client) => {
    const { rows } = await client.query(
      `SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
        ORDER BY table_name`
    );
    return { tables: rows.map(r => r.table_name) };
  });
}

async function fetchColumns(creds, { table, query }) {
  return withClient(creds, async (client) => {
    const sql = query
      ? `SELECT * FROM (${query}) _q LIMIT 5`
      : `SELECT * FROM "${table}" LIMIT 5`;
    const { rows, fields } = await client.query(sql);
    const columns = fields.map(f => f.name);
    return { columns, sample: rows };
  });
}

// Auto-suggest mapping from source column names to target column keys
function suggestMapping(sourceColumns) {
  const mapping = {};
  for (const src of sourceColumns) {
    const norm = normalize(src);
    let matched = null;
    for (const [target, aliases] of Object.entries(COLUMN_ALIASES)) {
      if (aliases.includes(norm) || normalize(target) === norm) {
        matched = target;
        break;
      }
    }
    mapping[src] = matched || '';
  }
  return mapping;
}

async function fetchRows(creds, { table, query }) {
  return withClient(creds, async (client) => {
    const sql = query
      ? query
      : `SELECT * FROM "${table}"`;
    const { rows, fields } = await client.query(sql);
    return { rows, columns: fields.map(f => f.name) };
  });
}

// Apply user-defined column map to a raw DB row → target schema object
function applyColumnMap(row, columnMap) {
  const out = {};
  for (const [src, target] of Object.entries(columnMap)) {
    if (!target) continue;
    const val = row[src];
    if (val !== null && val !== undefined) out[target] = String(val).trim();
  }
  return out;
}

module.exports = { testConnection, fetchColumns, suggestMapping, fetchRows, applyColumnMap };
