/**
 * migrationService.js
 * -------------------
 * All DB logic for the VMware → Proxmox migration tracker.
 * Tables: migration_projects, migration_hosts, migration_bomgar_vms,
 *         migration_security_vms, migration_standalone_esxi
 */
const db       = require('../config/db');
const { encrypt, decrypt } = require('../utils/crypto');
const ExcelJS  = require('exceljs');

const VALID_MIGRATION_STATUSES = ['Not Started', 'In Progress', 'Completed', 'Blocked'];
const VALID_STAGE_STATUSES     = ['Pending', 'In Progress', 'Completed'];

function normaliseMigrationStatus(raw) {
  if (!raw || !raw.toString().trim()) return 'Not Started';
  const v = raw.toString().trim();
  if (/^complet/i.test(v)) return 'Completed';
  if (/^in.?prog/i.test(v)) return 'In Progress';
  if (/^block/i.test(v))   return 'Blocked';
  if (/^pend/i.test(v))    return 'Pending';
  return VALID_MIGRATION_STATUSES.includes(v) ? v : 'Not Started';
}

function normaliseStageStatus(raw) {
  if (!raw || !raw.toString().trim()) return 'Pending';
  const v = raw.toString().trim();
  if (/^complet/i.test(v))  return 'Completed';
  if (/^in.?prog/i.test(v)) return 'In Progress';
  return 'Pending';
}

function int(v) { const n = parseInt(v, 10); return isNaN(n) ? null : n; }
function big(v) { const n = parseInt(v, 10); return isNaN(n) ? null : n; }
function str(v) { return v == null || v === '' ? null : String(v).trim(); }

function parseDate(v) {
  if (!v) return null;
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

function buildWhereClause(params, cols) {
  const conds  = ['TRUE'];
  const values = [];
  let   idx    = 1;

  if (params.project_id) {
    const pid = parseInt(params.project_id, 10);
    if (!isNaN(pid)) { values.push(pid); conds.push(`project_id = $${idx++}`); }
  }

  if (params.search) {
    const like = `%${params.search}%`;
    const orParts = cols.map(c => { values.push(like); return `${c}::text ILIKE $${idx++}`; });
    conds.push(`(${orParts.join(' OR ')})`);
  }

  const equalities = ['datacenter', 'host', 'powerstate', 'migration_status',
                      'vcenter', 'assigned_to', 'host_owner', 'vi_sdk_server',
                      'vms_vacate', 'proxmox_install', 'vm_migration_back'];
  for (const f of equalities) {
    if (params[f]) { values.push(params[f]); conds.push(`${f} = $${idx++}`); }
  }

  if (params.os_family) {
    if (params.os_family === 'Windows') {
      values.push('%Windows%');
      const i = idx++;
      conds.push(`(os_config ILIKE $${i} OR os_tools ILIKE $${i})`);
    } else if (params.os_family === 'Linux') {
      const patterns = ['%Linux%', '%Ubuntu%', '%CentOS%', '%Red Hat%', '%Debian%', '%SUSE%'];
      const orParts = [];
      for (const p of patterns) { values.push(p); orParts.push(`(os_config ILIKE $${idx} OR os_tools ILIKE $${idx})`); idx++; }
      conds.push(`(${orParts.join(' OR ')})`);
    } else {
      const winPat = ['%Windows%'];
      const linPat = ['%Linux%', '%Ubuntu%', '%CentOS%', '%Red Hat%', '%Debian%', '%SUSE%'];
      const winParts = winPat.map(p => { values.push(p); return `(os_config ILIKE $${idx} OR os_tools ILIKE $${idx++})`; });
      const linParts = linPat.map(p => { values.push(p); return `(os_config ILIKE $${idx} OR os_tools ILIKE $${idx++})`; });
      conds.push(`NOT (${[...winParts, ...linParts].join(' OR ')})`);
    }
  }

  if (params.expiring === '30') {
    conds.push(`license_expiry_date BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '30 days'`);
  } else if (params.expiring === 'expired') {
    conds.push(`license_expiry_date < CURRENT_DATE`);
  }

  if (params.missing_ip === '1') conds.push(`(primary_ip IS NULL OR primary_ip = '')`);

  return { where: conds.join(' AND '), values, nextIdx: idx };
}

// ── MIGRATION PROJECTS ────────────────────────────────────────────────────────
async function getProjects() {
  const { rows } = await db.query(
    `SELECT id, name, environment, is_default
       FROM migration_projects
      ORDER BY is_default DESC, created_at ASC`
  );
  return rows;
}

async function listProjectsWithStats() {
  const [projRes, tabCfgRes, customTabRes] = await Promise.all([
    db.query(`
      SELECT p.*,
        (SELECT COUNT(*)::int FROM migration_hosts           WHERE project_id = p.id) AS host_count,
        (SELECT COUNT(*)::int FROM migration_bomgar_vms      WHERE project_id = p.id) AS bomgar_count,
        (SELECT COUNT(*)::int FROM migration_security_vms    WHERE project_id = p.id) AS security_count,
        (SELECT COUNT(*)::int FROM migration_standalone_esxi WHERE project_id = p.id) AS standalone_count
      FROM migration_projects p
      ORDER BY p.is_default DESC, p.created_at ASC
    `),
    db.query(`SELECT project_id, tab_key, label, enabled FROM migration_tab_configs`),
    db.query(`
      SELECT ct.project_id, ct.id, ct.label, ct.enabled, ct.sort_order,
             (SELECT COUNT(*)::int FROM migration_custom_vms cv WHERE cv.custom_tab_id = ct.id) AS vm_count
        FROM migration_custom_tabs ct
       ORDER BY ct.project_id, ct.sort_order, ct.id
    `),
  ]);

  // index tab configs and custom tabs by project
  const tabCfgByProject = {};
  for (const r of tabCfgRes.rows) {
    if (!tabCfgByProject[r.project_id]) tabCfgByProject[r.project_id] = {};
    tabCfgByProject[r.project_id][r.tab_key] = { label: r.label, enabled: r.enabled };
  }
  const customByProject = {};
  for (const r of customTabRes.rows) {
    if (!customByProject[r.project_id]) customByProject[r.project_id] = [];
    customByProject[r.project_id].push({ id: r.id, label: r.label, enabled: r.enabled, vm_count: r.vm_count });
  }

  return projRes.rows.map(p => ({
    ...p,
    tab_configs:  tabCfgByProject[p.id]  || {},
    custom_tabs:  customByProject[p.id]  || [],
  }));
}

async function createProject({ name, environment, description, is_default }) {
  if (!name?.trim()) throw new Error('Project name is required');
  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    if (is_default) await client.query('UPDATE migration_projects SET is_default = false');
    const { rows } = await client.query(
      `INSERT INTO migration_projects (name, environment, description, is_default)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [name.trim(), str(environment), str(description), !!is_default]
    );
    await client.query('COMMIT');
    return rows[0];
  } catch (e) { await client.query('ROLLBACK'); throw e; }
  finally { client.release(); }
}

async function updateProject(id, { name, environment, description, is_default }) {
  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    if (is_default) {
      await client.query('UPDATE migration_projects SET is_default = false WHERE id != $1', [id]);
    }
    const { rows } = await client.query(
      `UPDATE migration_projects
         SET name        = COALESCE($1, name),
             environment = $2,
             description = $3,
             is_default  = COALESCE($4, is_default),
             updated_at  = NOW()
       WHERE id = $5 RETURNING *`,
      [name?.trim() || null, str(environment), str(description), is_default ?? null, id]
    );
    await client.query('COMMIT');
    return rows[0] || null;
  } catch (e) { await client.query('ROLLBACK'); throw e; }
  finally { client.release(); }
}

async function deleteProject(id) {
  const { rows: all } = await db.query('SELECT COUNT(*)::int AS total FROM migration_projects');
  if (all[0]?.total <= 1) throw new Error('Cannot delete the last project. Create another project first.');
  const { rows: proj } = await db.query('SELECT is_default FROM migration_projects WHERE id = $1', [id]);
  if (!proj[0]) throw new Error('Project not found');
  if (proj[0].is_default) throw new Error('Cannot delete the default project. Set another project as default first.');

  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    const { rows: defProj } = await client.query(
      'SELECT id FROM migration_projects WHERE is_default AND id != $1 LIMIT 1', [id]);
    const defaultId = defProj[0]?.id;
    if (defaultId) {
      for (const t of ['migration_hosts','migration_bomgar_vms','migration_security_vms','migration_standalone_esxi']) {
        await client.query(`UPDATE ${t} SET project_id = $1 WHERE project_id = $2`, [defaultId, id]);
      }
    }
    await client.query('DELETE FROM migration_projects WHERE id = $1', [id]);
    await client.query('COMMIT');
  } catch (e) { await client.query('ROLLBACK'); throw e; }
  finally { client.release(); }
}

// ── HOSTS ────────────────────────────────────────────────────────────────────
const HOST_SEARCH_COLS = ['vcenter', 'host', 'datacenter', 'idrac', 'esx_version',
  'model', 'serial_number', 'assigned_to', 'host_owner'];

async function listHosts(params) {
  const page     = Math.max(1, int(params.page) || 1);
  const pageSize = Math.min(200, Math.max(1, int(params.pageSize) || 20));
  const offset   = (page - 1) * pageSize;
  const { where, values, nextIdx } = buildWhereClause(params, HOST_SEARCH_COLS);

  const countQ = await db.query(`SELECT COUNT(*)::int AS total FROM migration_hosts WHERE ${where}`, values);
  const total  = countQ.rows[0]?.total ?? 0;

  const dataQ = await db.query(
    `SELECT id, vcenter, host, datacenter, idrac, idrac_virtual_console,
            assigned_licenses, esx_version, model, serial_number, bios_vendor,
            min_cores, license_expiry_date, assigned_to, vms_to_migrate,
            powered_off_vms, host_owner, vms_vacate, proxmox_install,
            vm_migration_back, notes, project_id, created_at, updated_at
       FROM migration_hosts WHERE ${where}
      ORDER BY datacenter NULLS LAST, host
      LIMIT $${nextIdx} OFFSET $${nextIdx + 1}`,
    [...values, pageSize, offset]);

  return { items: dataQ.rows, total, page, pageSize };
}

async function getHostCredentials(id) {
  const { rows } = await db.query(
    `SELECT idrac_username_enc, idrac_password_enc FROM migration_hosts WHERE id = $1`, [id]);
  if (!rows[0]) return null;
  return {
    idrac_username: decrypt(rows[0].idrac_username_enc),
    idrac_password: decrypt(rows[0].idrac_password_enc),
  };
}

async function hostsSummary(projectId = null) {
  const pidAnd = projectId ? `AND project_id = $1` : '';
  const vals   = projectId ? [parseInt(projectId, 10)] : [];

  const { rows } = await db.query(`
    SELECT
      COUNT(*)::int                                                                AS total_hosts,
      COUNT(*) FILTER (WHERE vms_vacate='Completed'
                         AND proxmox_install='Completed'
                         AND vm_migration_back='Completed')::int                  AS fully_migrated,
      COUNT(*) FILTER (WHERE vms_vacate != 'Completed')::int                     AS pending_vacate,
      COALESCE(SUM(vms_to_migrate),0)::int                                        AS total_vms_to_migrate,
      COALESCE(SUM(powered_off_vms),0)::int                                       AS total_powered_off
    FROM migration_hosts WHERE TRUE ${pidAnd}`, vals);

  const byDc = await db.query(`
    SELECT datacenter, COUNT(*)::int AS count
      FROM migration_hosts WHERE TRUE ${pidAnd}
     GROUP BY datacenter ORDER BY count DESC`, vals);

  return { ...rows[0], by_datacenter: byDc.rows };
}

async function patchHost(id, fields) {
  const allowed = ['vcenter','host','datacenter','idrac','idrac_virtual_console',
    'assigned_licenses','esx_version','model','serial_number','bios_vendor',
    'min_cores','license_expiry_date','assigned_to','vms_to_migrate',
    'powered_off_vms','host_owner','vms_vacate','proxmox_install','vm_migration_back','notes'];
  const sets = []; const vals = [];
  let i = 1;
  for (const [k, v] of Object.entries(fields)) {
    if (!allowed.includes(k)) continue;
    if (['vms_vacate','proxmox_install','vm_migration_back'].includes(k) && !VALID_STAGE_STATUSES.includes(v)) continue;
    sets.push(`${k} = $${i++}`);
    vals.push(v === '' ? null : v);
  }
  if (!sets.length) return null;
  sets.push(`updated_at = NOW()`);
  vals.push(id);
  const { rows } = await db.query(`UPDATE migration_hosts SET ${sets.join(', ')} WHERE id = $${i} RETURNING id`, vals);
  return rows[0] || null;
}

// ── VM LIST HELPERS ───────────────────────────────────────────────────────────
async function listVMs(table, searchCols, params) {
  const page     = Math.max(1, int(params.page) || 1);
  const pageSize = Math.min(200, Math.max(1, int(params.pageSize) || 20));
  const offset   = (page - 1) * pageSize;
  const { where, values, nextIdx } = buildWhereClause(params, searchCols);

  const countQ = await db.query(`SELECT COUNT(*)::int AS total FROM ${table} WHERE ${where}`, values);
  const total  = countQ.rows[0]?.total ?? 0;

  const dataQ = await db.query(
    `SELECT * FROM ${table}
      WHERE ${where}
      ORDER BY CASE migration_status WHEN 'Completed' THEN 1 ELSE 0 END, vm
      LIMIT $${nextIdx} OFFSET $${nextIdx + 1}`,
    [...values, pageSize, offset]);

  return { items: dataQ.rows, total, page, pageSize };
}

async function vmSummary(table, projectId = null) {
  const pidAnd = projectId ? `AND project_id = $1` : '';
  const vals   = projectId ? [parseInt(projectId, 10)] : [];

  const { rows } = await db.query(`
    SELECT
      COUNT(*)::int                                                           AS total,
      COUNT(*) FILTER (WHERE migration_status = 'Completed')::int           AS migrated,
      COUNT(*) FILTER (WHERE migration_status != 'Completed')::int          AS pending,
      COUNT(*) FILTER (WHERE migration_status = 'In Progress')::int         AS in_progress,
      COUNT(*) FILTER (WHERE migration_status = 'Blocked')::int             AS blocked,
      COUNT(*) FILTER (WHERE LOWER(powerstate) != 'poweredon')::int         AS powered_off,
      COALESCE(SUM(cpus),0)::int                                             AS total_vcpus,
      COALESCE(SUM(memory_mib),0)::bigint                                    AS total_memory_mib
    FROM ${table} WHERE TRUE ${pidAnd}`, vals);
  return rows[0];
}

async function patchVM(table, id, fields) {
  const allowed = ['migration_status', 'notes'];
  const sets = []; const vals = [];
  let i = 1;
  for (const [k, v] of Object.entries(fields)) {
    if (!allowed.includes(k)) continue;
    if (k === 'migration_status' && !VALID_MIGRATION_STATUSES.includes(v)) continue;
    sets.push(`${k} = $${i++}`);
    vals.push(v === '' ? null : v);
  }
  if (!sets.length) return null;
  sets.push(`updated_at = NOW()`);
  vals.push(id);
  const { rows } = await db.query(`UPDATE ${table} SET ${sets.join(', ')} WHERE id = $${i} RETURNING id`, vals);
  return rows[0] || null;
}

// ── PUBLIC VM WRAPPERS ────────────────────────────────────────────────────────
const BOMGAR_SEARCH_COLS     = ['vm','dns_name','primary_ip','datacenter','cluster','host','os_config','os_tools','vm_id'];
const SECURITY_SEARCH_COLS   = ['vm','primary_ip','mac_address','host','os_config','os_tools','vm_id','vm_uuid'];
const STANDALONE_SEARCH_COLS = ['vm','primary_ip','mac_address','host','os_config','os_tools','vi_sdk_server'];

const listBomgarVMs     = (p) => listVMs('migration_bomgar_vms',     BOMGAR_SEARCH_COLS,     p);
const listSecurityVMs   = (p) => listVMs('migration_security_vms',   SECURITY_SEARCH_COLS,   p);
const listStandaloneVMs = (p) => listVMs('migration_standalone_esxi', STANDALONE_SEARCH_COLS, p);

const bomgarSummary     = (pid) => vmSummary('migration_bomgar_vms',     pid);
const securitySummary   = (pid) => vmSummary('migration_security_vms',   pid);
const standaloneSummary = (pid) => vmSummary('migration_standalone_esxi', pid);

const patchBomgarVM     = (id, f) => patchVM('migration_bomgar_vms',     id, f);
const patchSecurityVM   = (id, f) => patchVM('migration_security_vms',   id, f);
const patchStandaloneVM = (id, f) => patchVM('migration_standalone_esxi', id, f);

// ── OVERVIEW ─────────────────────────────────────────────────────────────────
async function overview(projectId = null) {
  const [hosts, bomgar, security, standalone] = await Promise.all([
    hostsSummary(projectId),
    vmSummary('migration_bomgar_vms',     projectId),
    vmSummary('migration_security_vms',   projectId),
    vmSummary('migration_standalone_esxi', projectId),
  ]);
  const totalVMs = (bomgar.total || 0) + (security.total || 0) + (standalone.total || 0);
  const migrated = (bomgar.migrated || 0) + (security.migrated || 0) + (standalone.migrated || 0);
  return { hosts, bomgar, security, standalone, totalVMs, migrated, remaining: totalVMs - migrated };
}

// ── CSV EXPORT ────────────────────────────────────────────────────────────────
async function exportCSV(type, params) {
  const bigParams = { ...params, page: 1, pageSize: 99999 };
  let result;
  switch (type) {
    case 'hosts':           result = await listHosts(bigParams);         break;
    case 'bomgar-vms':      result = await listBomgarVMs(bigParams);     break;
    case 'security-vms':    result = await listSecurityVMs(bigParams);   break;
    case 'standalone-esxi': result = await listStandaloneVMs(bigParams); break;
    default: throw new Error('Unknown type');
  }
  return result.items;
}

// ── XLSX IMPORT ───────────────────────────────────────────────────────────────
const SHEET_MAP = {
  'Hosts':           { table: 'migration_hosts',           mapper: mapHostRow },
  'Bomgar VMs':      { table: 'migration_bomgar_vms',      mapper: mapBomgarRow },
  'Security VMs':    { table: 'migration_security_vms',    mapper: mapSecurityRow },
  'Standalone ESXi': { table: 'migration_standalone_esxi', mapper: mapStandaloneRow },
};

function hdr(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]/g, ''); }

// Known column keys that confirm a row is the real header row
const KNOWN_HDRS = new Set(['vm', 'host', 'vcenter', 'powerstate', 'cpus', 'memory', 'datacenter', 'cluster', 'migrationstatus']);

function buildHdrMap(ws) {
  // Try row 1 first; if it doesn't contain any recognised column names, try row 2.
  // This handles both plain files (headers in row 1) and templated files that have
  // an instruction note in row 1 with the real headers in row 2.
  for (const rowNum of [1, 2]) {
    const row = ws.getRow(rowNum);
    const map = {};
    row.eachCell((cell, col) => {
      const key = hdr(String(cell.value || ''));
      if (key) map[key] = col;
    });
    const hasKnown = Object.keys(map).some(k => KNOWN_HDRS.has(k));
    if (hasKnown) return { hdrMap: map, dataStartRow: rowNum + 1 };
  }
  // Fallback: use row 1 and start data at row 2
  const map = {};
  ws.getRow(1).eachCell((cell, col) => { const k = hdr(String(cell.value || '')); if (k) map[k] = col; });
  return { hdrMap: map, dataStartRow: 2 };
}

function get(row, idx) {
  if (idx < 0) return null;
  const cell = row.getCell(idx);
  const v = cell?.value;
  if (v == null) return null;
  if (typeof v === 'object' && v.result !== undefined) return v.result;
  if (typeof v === 'object' && v.text   !== undefined) return v.text;
  return v;
}

function mapHostRow(row, hdrMap) {
  const g = (col) => get(row, hdrMap[hdr(col)] ?? -1);
  const username = str(g('iDRAC username')) || str(g('idrac username'));
  const password = str(g('iDRAC password')) || str(g('idrac password'));
  return {
    vcenter:               str(g('vCenter'))                     || str(g('vcenter')),
    host:                  str(g('Host'))                        || str(g('host')) || `Row${row.number}`,
    datacenter:            str(g('Datacenter'))                  || str(g('datacenter')),
    idrac:                 str(g('iDRAC'))                       || str(g('idrac')),
    idrac_username_enc:    username ? encrypt(username) : null,
    idrac_password_enc:    password ? encrypt(password) : null,
    idrac_virtual_console: str(g('iDRAC Virtual Console'))       || str(g('idrac virtual console')),
    assigned_licenses:     str(g('Assigned License(s)'))         || str(g('assigned licenses')),
    esx_version:           str(g('ESX Version'))                 || str(g('esx version')),
    model:                 str(g('Model')),
    serial_number:         str(g('Serial Number'))               || str(g('serial number')),
    bios_vendor:           str(g('BIOS Vendor'))                 || str(g('bios vendor')),
    min_cores:             int(g('# Min Cores'))                 ?? int(g('min cores')),
    license_expiry_date:   parseDate(g('License Expiry Date')    || g('license expiry date')),
    assigned_to:           str(g('Assigned To'))                 || str(g('assigned to')),
    vms_to_migrate:        int(g('No. of VMs to Migrate'))       ?? int(g('vms to migrate')),
    powered_off_vms:       int(g('Powered Off VMs'))             ?? int(g('powered off vms')),
    host_owner:            str(g('Host Owner'))                  || str(g('host owner')),
    vms_vacate:            normaliseStageStatus(g('VMs Vacate')                            || g('vms vacate')),
    proxmox_install:       normaliseStageStatus(g('Proxmox Install')                       || g('proxmox install')),
    vm_migration_back:     normaliseStageStatus(g('VM Migration Back to New Proxmox Host') || g('vm migration back')),
  };
}

function mapBomgarRow(row, hdrMap) {
  const g = (col) => get(row, hdrMap[hdr(col)] ?? -1);
  return {
    vm:                      str(g('VM'))                              || `Row${row.number}`,
    powerstate:              str(g('Powerstate')),
    dns_name:                str(g('DNS Name'))                        || str(g('dns name')),
    cpus:                    int(g('CPUs')),
    memory_mib:              big(g('Memory')),
    active_memory_mib:       big(g('Active Memory'))                   ?? big(g('active memory')),
    nics:                    int(g('NICs')),
    disks:                   int(g('Disks')),
    total_disk_capacity_mib: big(g('Total Disk Capacity (MiB)'))       ?? big(g('total disk capacity mib')),
    primary_ip:              str(g('Primary IP Address'))              || str(g('primary ip')),
    network_1:               str(g('Network #1'))                      || str(g('network 1')),
    firmware:                str(g('Firmware')),
    hw_version:              str(g('HW Version'))                      || str(g('hw version')),
    path:                    str(g('Path')),
    datacenter:              str(g('Datacenter')),
    cluster:                 str(g('Cluster')),
    host:                    str(g('Host')),
    os_config:               str(g('OS (config file)'))                || str(g('os config')),
    os_tools:                str(g('OS (VMware Tools)'))               || str(g('os tools')),
    vm_id:                   str(g('VM ID'))                           || str(g('vmid')),
    migration_status:        normaliseMigrationStatus(g('MIGRATION STATUS') || g('migration status')),
  };
}

function mapSecurityRow(row, hdrMap) {
  const g = (col) => get(row, hdrMap[hdr(col)] ?? -1);
  return {
    vm:                      str(g('VM'))                              || `Row${row.number}`,
    primary_ip:              str(g('Primary IP Address'))              || str(g('primary ip')),
    mac_address:             str(g('Mac Address'))                     || str(g('mac address')),
    host:                    str(g('Host')),
    powerstate:              str(g('Powerstate')),
    guest_state:             str(g('Guest State'))                     || str(g('guest state')),
    cpus:                    int(g('CPUs')),
    memory_mib:              big(g('Memory')),
    nics:                    int(g('NICs')),
    disks:                   int(g('Disks')),
    total_disk_capacity_mib: big(g('Total Disk Capacity (MiB)'))       ?? big(g('total disk capacity mib')),
    network_1:               str(g('Network #1'))                      || str(g('network 1')),
    firmware:                str(g('Firmware')),
    hw_version:              str(g('HW Version'))                      || str(g('hw version')),
    os_config:               str(g('OS (config file)'))                || str(g('os config')),
    os_tools:                str(g('OS (VMware Tools)'))               || str(g('os tools')),
    vm_id:                   str(g('VM ID'))                           || str(g('vmid')),
    vm_uuid:                 str(g('VM UUID'))                         || str(g('vm uuid')),
    migration_status:        normaliseMigrationStatus(g('MIGRATION STATUS') || g('migration status')),
  };
}

function mapStandaloneRow(row, hdrMap) {
  const g = (col) => get(row, hdrMap[hdr(col)] ?? -1);
  return {
    vm:                      str(g('VM'))                              || `Row${row.number}`,
    primary_ip:              str(g('Primary IP Address'))              || str(g('primary ip')),
    mac_address:             str(g('Mac Address'))                     || str(g('mac address')),
    host:                    str(g('Host')),
    powerstate:              str(g('Powerstate')),
    guest_state:             str(g('Guest State'))                     || str(g('guest state')),
    cpus:                    int(g('CPUs')),
    memory_mib:              big(g('Memory')),
    nics:                    int(g('NICs')),
    disks:                   int(g('Disks')),
    total_disk_capacity_mib: big(g('Total Disk Capacity (MiB)'))       ?? big(g('total disk capacity mib')),
    network_1:               str(g('Network #1'))                      || str(g('network 1')),
    firmware:                str(g('Firmware')),
    hw_version:              str(g('HW Version'))                      || str(g('hw version')),
    os_config:               str(g('OS (config file)'))                || str(g('os config')),
    os_tools:                str(g('OS (VMware Tools)'))               || str(g('os tools')),
    vi_sdk_api_version:      str(g('VI SDK API Version'))              || str(g('vi sdk api version')),
    vi_sdk_server:           str(g('VI SDK Server'))                   || str(g('vi sdk server')),
    migration_status:        normaliseMigrationStatus(g('MIGRATION STATUS') || g('migration status')),
  };
}

async function previewImport(buffer, projectId = null) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);

  // load custom tab labels for this project so we can recognise extra sheets
  const customTabsByLabel = {};
  if (projectId) {
    const pid = parseInt(projectId, 10);
    if (!isNaN(pid)) {
      const { rows } = await db.query(
        `SELECT id, label FROM migration_custom_tabs WHERE project_id = $1`, [pid]
      );
      for (const r of rows) customTabsByLabel[r.label.toLowerCase()] = r;
    }
  }

  const result = {};
  for (const ws of wb.worksheets) {
    const sheetEntry = SHEET_MAP[ws.name];
    if (sheetEntry) {
      const { hdrMap, dataStartRow } = buildHdrMap(ws);
      const rows = [];
      ws.eachRow((row, rowNumber) => {
        if (rowNumber < dataStartRow) return;
        const mapped = sheetEntry.mapper(row, hdrMap);
        if (!mapped.vm && !mapped.host) return;
        const preview = { ...mapped };
        delete preview.idrac_username_enc;
        delete preview.idrac_password_enc;
        rows.push(preview);
      });
      result[ws.name] = { count: rows.length, sample: rows.slice(0, 5) };
    } else {
      // check if sheet matches a custom tab label
      const customTab = customTabsByLabel[ws.name.toLowerCase()];
      if (!customTab) continue;
      const { hdrMap, dataStartRow } = buildHdrMap(ws);
      const rows = [];
      ws.eachRow((row, rowNumber) => {
        if (rowNumber < dataStartRow) return;
        const mapped = mapCustomRow(row, hdrMap);
        if (!mapped.vm) return;
        rows.push(mapped);
      });
      result[ws.name] = { count: rows.length, sample: rows.slice(0, 5), isCustomTab: true, tabId: customTab.id };
    }
  }
  return result;
}

async function confirmImport(buffer, preserveStatus = false, projectId) {
  if (!projectId) throw new Error('project_id is required for import');
  const pid = parseInt(projectId, 10);
  if (isNaN(pid)) throw new Error('Invalid project_id');

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);

  const client = await db.getClient();
  const counts = {};

  try {
    await client.query('BEGIN');

    for (const ws of wb.worksheets) {
      const sheetEntry = SHEET_MAP[ws.name];
      if (!sheetEntry) continue;
      const { table, mapper } = sheetEntry;

      const { hdrMap, dataStartRow } = buildHdrMap(ws);

      let existingStatuses = {};
      if (preserveStatus) {
        const key = table === 'migration_hosts' ? 'host' : 'vm';
        const statusCols = table === 'migration_hosts' ? ', vms_vacate, proxmox_install, vm_migration_back' : '';
        const { rows: ex } = await client.query(
          `SELECT ${key}, migration_status${statusCols} FROM ${table} WHERE project_id = $1`, [pid]);
        for (const r of ex) existingStatuses[r[key]] = r;
      }

      await client.query(`DELETE FROM ${table} WHERE project_id = $1`, [pid]);

      const insertedRows = [];
      ws.eachRow((row, rowNumber) => {
        if (rowNumber < dataStartRow) return;
        const mapped = mapper(row, hdrMap);
        if (!mapped.vm && !mapped.host) return;

        if (preserveStatus) {
          const key = table === 'migration_hosts' ? 'host' : 'vm';
          const existing = existingStatuses[mapped[key]];
          if (existing) {
            if (table === 'migration_hosts') {
              mapped.vms_vacate        = existing.vms_vacate        || mapped.vms_vacate;
              mapped.proxmox_install   = existing.proxmox_install   || mapped.proxmox_install;
              mapped.vm_migration_back = existing.vm_migration_back || mapped.vm_migration_back;
            } else {
              mapped.migration_status  = existing.migration_status  || mapped.migration_status;
            }
          }
        }

        insertedRows.push({ ...mapped, project_id: pid });
      });

      if (insertedRows.length === 0) { counts[ws.name] = 0; continue; }

      const keys = Object.keys(insertedRows[0]);
      const colNames = keys.join(', ');
      const valuePlaceholders = insertedRows.map((_, ri) =>
        `(${keys.map((__, ci) => `$${ri * keys.length + ci + 1}`).join(', ')})`
      ).join(', ');
      const flatValues = insertedRows.flatMap(r => keys.map(k => r[k] ?? null));

      await client.query(`INSERT INTO ${table} (${colNames}) VALUES ${valuePlaceholders}`, flatValues);
      counts[ws.name] = insertedRows.length;
    }

    // ── Custom tab sheets ─────────────────────────────────────────────────
    const { rows: ctRows } = await client.query(
      `SELECT id, label FROM migration_custom_tabs WHERE project_id = $1`, [pid]
    );
    const customTabsByLabel = {};
    for (const t of ctRows) customTabsByLabel[t.label.toLowerCase()] = t;

    for (const ws of wb.worksheets) {
      if (SHEET_MAP[ws.name]) continue; // already handled above
      const customTab = customTabsByLabel[ws.name.toLowerCase()];
      if (!customTab) continue;

      const { hdrMap: customHdrMap, dataStartRow: customDataStart } = buildHdrMap(ws);

      let existingStatuses = {};
      if (preserveStatus) {
        const { rows: ex } = await client.query(
          `SELECT vm, migration_status FROM migration_custom_vms WHERE custom_tab_id = $1 AND project_id = $2`,
          [customTab.id, pid]
        );
        for (const r of ex) existingStatuses[r.vm] = r.migration_status;
      }

      await client.query(
        `DELETE FROM migration_custom_vms WHERE custom_tab_id = $1 AND project_id = $2`,
        [customTab.id, pid]
      );

      const insertedRows = [];
      ws.eachRow((row, rowNumber) => {
        if (rowNumber < customDataStart) return;
        const mapped = mapCustomRow(row, customHdrMap);
        if (!mapped.vm) return;
        if (preserveStatus && existingStatuses[mapped.vm]) {
          mapped.migration_status = existingStatuses[mapped.vm];
        }
        insertedRows.push({ ...mapped, custom_tab_id: customTab.id, project_id: pid });
      });

      if (insertedRows.length === 0) { counts[ws.name] = 0; continue; }

      const keys = Object.keys(insertedRows[0]);
      const colNames = keys.join(', ');
      const valuePlaceholders = insertedRows.map((_, ri) =>
        `(${keys.map((__, ci) => `$${ri * keys.length + ci + 1}`).join(', ')})`
      ).join(', ');
      const flatValues = insertedRows.flatMap(r => keys.map(k => r[k] ?? null));

      await client.query(`INSERT INTO migration_custom_vms (${colNames}) VALUES ${valuePlaceholders}`, flatValues);
      counts[ws.name] = insertedRows.length;
    }

    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }

  return counts;
}

// ── FILTER OPTIONS ────────────────────────────────────────────────────────────
async function filterOptions(type, projectId = null) {
  const tableMap = {
    'hosts':            'migration_hosts',
    'bomgar-vms':       'migration_bomgar_vms',
    'security-vms':     'migration_security_vms',
    'standalone-esxi':  'migration_standalone_esxi',
  };
  const table = tableMap[type];
  if (!table) throw new Error('Unknown type');

  const pidWhere = projectId ? `WHERE project_id = $1 AND` : `WHERE`;
  const vals     = projectId ? [parseInt(projectId, 10)] : [];

  const queries = [];

  if (table === 'migration_hosts') {
    queries.push(
      db.query(`SELECT DISTINCT datacenter FROM ${table} ${pidWhere} datacenter IS NOT NULL ORDER BY datacenter`, vals),
      db.query(`SELECT DISTINCT vcenter     FROM ${table} ${pidWhere} vcenter IS NOT NULL ORDER BY vcenter`,     vals),
      db.query(`SELECT DISTINCT assigned_to FROM ${table} ${pidWhere} assigned_to IS NOT NULL ORDER BY assigned_to`, vals),
      db.query(`SELECT DISTINCT host_owner  FROM ${table} ${pidWhere} host_owner IS NOT NULL ORDER BY host_owner`,  vals),
    );
    const [dc, vc, at, ho] = await Promise.all(queries);
    return {
      datacenter:  dc.rows.map(r => r.datacenter),
      vcenter:     vc.rows.map(r => r.vcenter),
      assigned_to: at.rows.map(r => r.assigned_to),
      host_owner:  ho.rows.map(r => r.host_owner),
    };
  }

  queries.push(
    db.query(`SELECT DISTINCT host             FROM ${table} ${pidWhere} host IS NOT NULL ORDER BY host`,             vals),
    db.query(`SELECT DISTINCT powerstate       FROM ${table} ${pidWhere} powerstate IS NOT NULL ORDER BY powerstate`, vals),
    db.query(`SELECT DISTINCT migration_status FROM ${table} ${pidWhere} migration_status IS NOT NULL ORDER BY migration_status`, vals),
  );
  if (table === 'migration_bomgar_vms') {
    queries.push(db.query(`SELECT DISTINCT datacenter   FROM ${table} ${pidWhere} datacenter IS NOT NULL ORDER BY datacenter`,     vals));
  }
  if (table === 'migration_standalone_esxi') {
    queries.push(db.query(`SELECT DISTINCT vi_sdk_server FROM ${table} ${pidWhere} vi_sdk_server IS NOT NULL ORDER BY vi_sdk_server`, vals));
  }

  const results = await Promise.all(queries);
  const out = {
    host:             results[0].rows.map(r => r.host),
    powerstate:       results[1].rows.map(r => r.powerstate),
    migration_status: results[2].rows.map(r => r.migration_status),
  };
  if (table === 'migration_bomgar_vms')      out.datacenter    = results[3]?.rows.map(r => r.datacenter);
  if (table === 'migration_standalone_esxi') out.vi_sdk_server = results[3]?.rows.map(r => r.vi_sdk_server);
  return out;
}

// ── CUSTOM ROW MAPPER (for user-created tabs) ────────────────────────────────
function mapCustomRow(row, hdrMap) {
  const g = (col) => get(row, hdrMap[hdr(col)] ?? -1);
  return {
    vm:                      str(g('VM'))                              || `Row${row.number}`,
    primary_ip:              str(g('Primary IP Address'))              || str(g('primary ip')),
    mac_address:             str(g('Mac Address'))                     || str(g('mac address')),
    dns_name:                str(g('DNS Name'))                        || str(g('dns name')),
    host:                    str(g('Host')),
    powerstate:              str(g('Powerstate')),
    guest_state:             str(g('Guest State'))                     || str(g('guest state')),
    cpus:                    int(g('CPUs')),
    memory_mib:              big(g('Memory')),
    nics:                    int(g('NICs')),
    disks:                   int(g('Disks')),
    total_disk_capacity_mib: big(g('Total Disk Capacity (MiB)'))       ?? big(g('total disk capacity mib')),
    os_config:               str(g('OS (config file)'))                || str(g('os config')),
    os_tools:                str(g('OS (VMware Tools)'))               || str(g('os tools')),
    datacenter:              str(g('Datacenter')),
    cluster:                 str(g('Cluster')),
    path:                    str(g('Path')),
    migration_status:        normaliseMigrationStatus(g('MIGRATION STATUS') || g('migration status')),
  };
}

// ── CUSTOM TAB CRUD ───────────────────────────────────────────────────────────

async function getCustomTabs(projectId) {
  const pid = parseInt(projectId, 10);
  if (isNaN(pid)) return [];
  const { rows } = await db.query(
    `SELECT * FROM migration_custom_tabs WHERE project_id = $1 ORDER BY sort_order, id`, [pid]
  );
  return rows;
}

async function createCustomTab(projectId, { label, enabled = true, hidden_columns = [] }) {
  if (!label?.trim()) throw new Error('Tab label is required');
  const pid = parseInt(projectId, 10);
  if (isNaN(pid)) throw new Error('Invalid project_id');
  const { rows } = await db.query(
    `INSERT INTO migration_custom_tabs (project_id, label, enabled, hidden_columns)
     VALUES ($1, $2, $3, $4) RETURNING *`,
    [pid, label.trim(), enabled, hidden_columns]
  );
  return rows[0];
}

async function updateCustomTab(id, { label, enabled, hidden_columns }) {
  const sets = [], vals = [];
  let idx = 1;
  if (label          !== undefined) { sets.push(`label = $${idx++}`);          vals.push(label || null); }
  if (enabled        !== undefined) { sets.push(`enabled = $${idx++}`);        vals.push(enabled); }
  if (hidden_columns !== undefined) { sets.push(`hidden_columns = $${idx++}`); vals.push(hidden_columns); }
  if (!sets.length) return null;
  sets.push(`updated_at = NOW()`);
  vals.push(parseInt(id, 10));
  const { rows } = await db.query(
    `UPDATE migration_custom_tabs SET ${sets.join(', ')} WHERE id = $${idx} RETURNING *`, vals
  );
  return rows[0] || null;
}

async function deleteCustomTab(id) {
  await db.query(`DELETE FROM migration_custom_tabs WHERE id = $1`, [parseInt(id, 10)]);
}

// ── CUSTOM VM DATA ────────────────────────────────────────────────────────────

async function listCustomVMs(params) {
  const tabId = parseInt(params.tab_id, 10);
  if (isNaN(tabId)) return { items: [], total: 0, page: 1, pageSize: 50 };

  const page   = Math.max(1, parseInt(params.page, 10) || 1);
  const limit  = Math.min(500, Math.max(1, parseInt(params.pageSize, 10) || 50));
  const offset = (page - 1) * limit;

  const conds  = [`custom_tab_id = $1`];
  const values = [tabId];
  let idx = 2;

  if (params.search) {
    const like = `%${params.search}%`;
    const sCols = ['vm', 'primary_ip', 'host', 'mac_address', 'os_config', 'dns_name'];
    const orParts = sCols.map(c => { values.push(like); return `${c}::text ILIKE $${idx++}`; });
    conds.push(`(${orParts.join(' OR ')})`);
  }

  for (const col of ['host', 'powerstate', 'migration_status', 'guest_state']) {
    if (params[col]) { values.push(params[col]); conds.push(`${col} = $${idx++}`); }
  }

  const where = `WHERE ${conds.join(' AND ')}`;
  const [countRes, dataRes] = await Promise.all([
    db.query(`SELECT COUNT(*) FROM migration_custom_vms ${where}`, values),
    db.query(`SELECT * FROM migration_custom_vms ${where} ORDER BY vm LIMIT $${idx} OFFSET $${idx + 1}`,
      [...values, limit, offset]),
  ]);

  return {
    total:    parseInt(countRes.rows[0].count, 10),
    items:    dataRes.rows,
    page,
    pageSize: limit,
  };
}

async function patchCustomVM(id, fields) {
  const allowed = [
    'migration_status', 'powerstate', 'guest_state', 'primary_ip', 'host',
    'mac_address', 'dns_name', 'cpus', 'memory_mib', 'total_disk_capacity_mib',
    'nics', 'disks', 'os_config', 'os_tools', 'datacenter', 'cluster', 'path',
  ];
  const sets = [], vals = [];
  let idx = 1;
  for (const [k, v] of Object.entries(fields)) {
    if (allowed.includes(k)) { sets.push(`${k} = $${idx++}`); vals.push(v); }
  }
  if (!sets.length) return null;
  sets.push(`updated_at = NOW()`);
  vals.push(parseInt(id, 10));
  const { rows } = await db.query(
    `UPDATE migration_custom_vms SET ${sets.join(', ')} WHERE id = $${idx} RETURNING *`, vals
  );
  return rows[0] || null;
}

async function customVMSummary(tabId) {
  const tid = parseInt(tabId, 10);
  if (isNaN(tid)) return { total: 0, migrated: 0, pending: 0, in_progress: 0, blocked: 0, powered_off: 0 };
  const { rows } = await db.query(`
    SELECT
      COUNT(*)                                                 AS total,
      COUNT(*) FILTER (WHERE migration_status = 'Completed')  AS migrated,
      COUNT(*) FILTER (WHERE migration_status = 'Not Started') AS pending,
      COUNT(*) FILTER (WHERE migration_status = 'In Progress') AS in_progress,
      COUNT(*) FILTER (WHERE migration_status = 'Blocked')    AS blocked,
      COUNT(*) FILTER (WHERE powerstate ILIKE '%off%')        AS powered_off
    FROM migration_custom_vms WHERE custom_tab_id = $1
  `, [tid]);
  const r = rows[0];
  return {
    total:       parseInt(r.total, 10),
    migrated:    parseInt(r.migrated, 10),
    pending:     parseInt(r.pending, 10),
    in_progress: parseInt(r.in_progress, 10),
    blocked:     parseInt(r.blocked, 10),
    powered_off: parseInt(r.powered_off, 10),
  };
}

async function customFilterOptions(tabId) {
  const tid = parseInt(tabId, 10);
  if (isNaN(tid)) return {};
  const [host, ps, ms] = await Promise.all([
    db.query(`SELECT DISTINCT host FROM migration_custom_vms WHERE custom_tab_id = $1 AND host IS NOT NULL ORDER BY host`, [tid]),
    db.query(`SELECT DISTINCT powerstate FROM migration_custom_vms WHERE custom_tab_id = $1 AND powerstate IS NOT NULL ORDER BY powerstate`, [tid]),
    db.query(`SELECT DISTINCT migration_status FROM migration_custom_vms WHERE custom_tab_id = $1 AND migration_status IS NOT NULL ORDER BY migration_status`, [tid]),
  ]);
  return {
    host:             host.rows.map(r => r.host),
    powerstate:       ps.rows.map(r => r.powerstate),
    migration_status: ms.rows.map(r => r.migration_status),
  };
}

// ── FIELD DEFINITIONS ────────────────────────────────────────────────────────

async function getFieldDefs(projectId, tabKey) {
  const pid = parseInt(projectId, 10);
  if (isNaN(pid)) return [];
  const { rows } = await db.query(
    `SELECT * FROM migration_field_definitions WHERE project_id = $1 AND tab_key = $2 ORDER BY sort_order, id`,
    [pid, tabKey]
  );
  return rows.map(r => ({ ...r, options: r.options ? r.options : null }));
}

async function createFieldDef(projectId, tabKey, { label, field_type = 'text', options, sort_order = 0, required = false }) {
  if (!label?.trim()) throw new Error('Field label is required');
  const pid = parseInt(projectId, 10);
  if (isNaN(pid)) throw new Error('Invalid project_id');
  const { rows } = await db.query(
    `INSERT INTO migration_field_definitions (project_id, tab_key, label, field_type, options, sort_order, required)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
    [pid, tabKey, label.trim(), field_type, options ? JSON.stringify(options) : null, sort_order, !!required]
  );
  return rows[0];
}

async function updateFieldDef(id, updates) {
  const allowed = { label: 'text', field_type: 'text', options: 'json', sort_order: 'int', required: 'bool' };
  const sets = [], vals = [];
  let idx = 1;
  for (const [k, type] of Object.entries(allowed)) {
    if (!(k in updates)) continue;
    sets.push(`${k} = $${idx++}`);
    if (type === 'json') vals.push(updates[k] != null ? JSON.stringify(updates[k]) : null);
    else if (type === 'int')  vals.push(parseInt(updates[k], 10));
    else if (type === 'bool') vals.push(!!updates[k]);
    else vals.push(updates[k]);
  }
  if (!sets.length) return null;
  sets.push(`updated_at = NOW()`);
  vals.push(parseInt(id, 10));
  const { rows } = await db.query(
    `UPDATE migration_field_definitions SET ${sets.join(', ')} WHERE id = $${idx} RETURNING *`, vals
  );
  return rows[0] || null;
}

async function deleteFieldDef(id) {
  await db.query(`DELETE FROM migration_field_definitions WHERE id = $1`, [parseInt(id, 10)]);
}

// ── FIELD VALUES ──────────────────────────────────────────────────────────────

async function getFieldValues(recordType, recordIds) {
  if (!recordIds?.length) return {};
  const ids = recordIds.map(id => parseInt(id, 10)).filter(id => !isNaN(id));
  if (!ids.length) return {};
  const { rows } = await db.query(
    `SELECT fv.field_def_id, fv.record_id, fv.value_text
       FROM migration_field_values fv
      WHERE fv.record_type = $1 AND fv.record_id = ANY($2::int[])`,
    [recordType, ids]
  );
  const result = {};
  for (const r of rows) {
    if (!result[r.record_id]) result[r.record_id] = {};
    result[r.record_id][r.field_def_id] = r.value_text;
  }
  return result;
}

async function setFieldValue(fieldDefId, recordType, recordId, value) {
  const { rows } = await db.query(`
    INSERT INTO migration_field_values (field_def_id, record_type, record_id, value_text, updated_at)
    VALUES ($1, $2, $3, $4, NOW())
    ON CONFLICT (field_def_id, record_id) DO UPDATE
      SET value_text = EXCLUDED.value_text, updated_at = NOW()
    RETURNING *
  `, [parseInt(fieldDefId, 10), recordType, parseInt(recordId, 10), value == null ? null : String(value)]);
  return rows[0];
}

// ── TAB CONFIG ───────────────────────────────────────────────────────────────

const TAB_KEYS = ['bomgar_vms', 'security_vms', 'standalone_esxi'];

async function getTabConfig(projectId) {
  const pid = parseInt(projectId, 10);
  if (isNaN(pid)) return {};
  const { rows } = await db.query(
    `SELECT tab_key, label, enabled, hidden_columns FROM migration_tab_configs WHERE project_id = $1`,
    [pid]
  );
  const map = {};
  for (const r of rows) {
    map[r.tab_key] = {
      label:          r.label,
      enabled:        r.enabled,
      hidden_columns: r.hidden_columns || [],
    };
  }
  return map;
}

async function saveTabConfigs(projectId, configs) {
  const pid = parseInt(projectId, 10);
  if (isNaN(pid)) throw new Error('Invalid project_id');
  for (const tabKey of TAB_KEYS) {
    if (!configs[tabKey]) continue;
    const { label, enabled, hidden_columns } = configs[tabKey];
    await db.query(`
      INSERT INTO migration_tab_configs (project_id, tab_key, label, enabled, hidden_columns, updated_at)
      VALUES ($1, $2, $3, $4, $5, NOW())
      ON CONFLICT (project_id, tab_key) DO UPDATE
        SET label = EXCLUDED.label,
            enabled = EXCLUDED.enabled,
            hidden_columns = EXCLUDED.hidden_columns,
            updated_at = NOW()
    `, [pid, tabKey, label || null, enabled ?? true, hidden_columns || []]);
  }
  return getTabConfig(projectId);
}

module.exports = {
  getProjects, listProjectsWithStats, createProject, updateProject, deleteProject,
  getTabConfig, saveTabConfigs,
  getCustomTabs, createCustomTab, updateCustomTab, deleteCustomTab,
  listCustomVMs, patchCustomVM, customVMSummary, customFilterOptions,
  getFieldDefs, createFieldDef, updateFieldDef, deleteFieldDef,
  getFieldValues, setFieldValue,
  listHosts, getHostCredentials, hostsSummary, patchHost,
  listBomgarVMs, bomgarSummary, patchBomgarVM,
  listSecurityVMs, securitySummary, patchSecurityVM,
  listStandaloneVMs, standaloneSummary, patchStandaloneVM,
  overview,
  previewImport, confirmImport, exportCSV,
  filterOptions,
  VALID_MIGRATION_STATUSES, VALID_STAGE_STATUSES,
};
