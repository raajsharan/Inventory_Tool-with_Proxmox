const db = require('../config/db');
const crypto = require('../utils/crypto');
const ApiError = require('../utils/ApiError');
const deptSvc = require('./departmentService');

const TABLE = 'beijing_assets';

const ASSET_COLUMNS = [
  'vm_name','os_hostname','ip_address','asset_type','os_type','os_version',
  'assigned_user','department','business_purpose','server_status','patching_type',
  'server_patch_type','patching_schedule','location','eol_status','serial_number',
  'ome_status','hosted_ip','asset_tag','asset_username','additional_remarks',
  'manage_engine_installed','tenable_installed','idrac_enabled','idrac_ip'
];

function mapBody(body) {
  const row = {};
  for (const c of ASSET_COLUMNS) {
    const camel = c.replace(/_([a-z])/g, (_, ch) => ch.toUpperCase());
    if (body[camel] !== undefined)      row[c] = body[camel];
    else if (body[c] !== undefined)     row[c] = body[c];
  }
  if (body.assetPassword !== undefined || body.asset_password !== undefined) {
    row.asset_password_encrypted = crypto.encrypt(body.assetPassword ?? body.asset_password);
  }
  if (body.extras !== undefined) {
    row.extras = typeof body.extras === 'string' ? body.extras : JSON.stringify(body.extras || {});
  }
  return row;
}

async function checkDuplicates({ vm_name, ip_address, asset_tag, excludeId }) {
  const conds = [];
  const params = [];
  if (vm_name)    { params.push(vm_name);    conds.push(`vm_name = $${params.length}`); }
  if (ip_address) { params.push(ip_address); conds.push(`ip_address = $${params.length}`); }
  if (asset_tag)  { params.push(asset_tag);  conds.push(`asset_tag = $${params.length}`); }
  if (!conds.length) return;
  let sql = `SELECT vm_name, ip_address, asset_tag FROM ${TABLE} WHERE (${conds.join(' OR ')})`;
  if (excludeId) { params.push(excludeId); sql += ` AND id <> $${params.length}`; }
  const { rows } = await db.query(sql, params);
  const dupes = {};
  for (const r of rows) {
    if (vm_name && r.vm_name === vm_name)          dupes.vm_name = 'duplicate VM name';
    if (ip_address && r.ip_address === ip_address) dupes.ip_address = 'duplicate IP address';
    if (asset_tag && r.asset_tag === asset_tag)    dupes.asset_tag = 'duplicate asset tag';
  }
  if (Object.keys(dupes).length) {
    throw new ApiError(409, 'Duplicate values', dupes);
  }
}

async function create(body, userId) {
  const row = mapBody(body);
  if (row.department && !row.asset_tag) {
    const next = await deptSvc.nextAvailableTag(row.department);
    if (next === null) {
      throw new ApiError(409, 'No available asset tags', {
        asset_tag: `All tags in ${row.department}'s range are in use`,
      });
    }
    row.asset_tag = String(next);
  }
  await deptSvc.validateDepartmentTag(row.department, row.asset_tag);
  if (row.asset_tag && await deptSvc.isTagUsedAnywhere(row.asset_tag)) {
    throw new ApiError(409, 'Duplicate values', { asset_tag: 'asset tag already used in another inventory' });
  }
  if (row.ip_address && await deptSvc.isIpUsedAnywhere(row.ip_address)) {
    throw new ApiError(409, 'Duplicate values', { ip_address: 'IP address already used in another inventory' });
  }
  await checkDuplicates({ vm_name: row.vm_name, ip_address: row.ip_address, asset_tag: row.asset_tag });
  row.created_by = userId;
  row.updated_by = userId;
  const cols = Object.keys(row);
  const vals = Object.values(row);
  const placeholders = cols.map((_, i) => `$${i + 1}`).join(',');
  const { rows } = await db.query(
    `INSERT INTO ${TABLE} (${cols.join(',')}) VALUES (${placeholders}) RETURNING *`,
    vals
  );
  return scrub(rows[0]);
}

async function update(id, body, userId) {
  const row = mapBody(body);
  if (!Object.keys(row).length) throw new ApiError(400, 'No fields to update');
  if (row.department !== undefined || row.asset_tag !== undefined) {
    const existing = await db.query(`SELECT department, asset_tag FROM ${TABLE} WHERE id = $1`, [id]);
    if (!existing.rows.length) throw new ApiError(404, 'Asset not found');
    const effDept = row.department !== undefined ? row.department : existing.rows[0].department;
    const effTag  = row.asset_tag  !== undefined ? row.asset_tag  : existing.rows[0].asset_tag;
    await deptSvc.validateDepartmentTag(effDept, effTag);
  }
  if (row.asset_tag && await deptSvc.isTagUsedAnywhere(row.asset_tag, { excludeTable: TABLE, excludeId: id })) {
    throw new ApiError(409, 'Duplicate values', { asset_tag: 'asset tag already used in another inventory' });
  }
  if (row.ip_address && await deptSvc.isIpUsedAnywhere(row.ip_address, { excludeTable: TABLE, excludeId: id })) {
    throw new ApiError(409, 'Duplicate values', { ip_address: 'IP address already used in another inventory' });
  }
  await checkDuplicates({
    vm_name: row.vm_name,
    ip_address: row.ip_address,
    asset_tag: row.asset_tag,
    excludeId: id,
  });
  row.updated_by = userId;
  const cols = Object.keys(row);
  const vals = Object.values(row);
  const set = cols.map((c, i) => `${c} = $${i + 1}`).join(',');
  vals.push(id);
  const { rows } = await db.query(
    `UPDATE ${TABLE} SET ${set} WHERE id = $${vals.length} RETURNING *`,
    vals
  );
  if (!rows.length) throw new ApiError(404, 'Asset not found');
  return scrub(rows[0]);
}

async function remove(id) {
  const { rowCount } = await db.query(`DELETE FROM ${TABLE} WHERE id = $1`, [id]);
  if (!rowCount) throw new ApiError(404, 'Asset not found');
}

async function get(id) {
  const { rows } = await db.query(
    `SELECT a.*,
            u.full_name  AS created_by_name,
            u2.full_name AS updated_by_name
       FROM ${TABLE} a
       LEFT JOIN users u  ON u.id  = a.created_by
       LEFT JOIN users u2 ON u2.id = a.updated_by
      WHERE a.id = $1`,
    [id]
  );
  if (!rows.length) throw new ApiError(404, 'Asset not found');
  return scrub(rows[0]);
}

async function viewPassword(id) {
  const { rows } = await db.query(`SELECT asset_password_encrypted FROM ${TABLE} WHERE id = $1`, [id]);
  if (!rows.length) throw new ApiError(404, 'Asset not found');
  if (!rows[0].asset_password_encrypted) return null;
  return crypto.decrypt(rows[0].asset_password_encrypted);
}

async function list({ search, osType, serverStatus, location, eolStatus, page = 1, pageSize = 20, sortBy = 'created_at', sortDir = 'desc' }) {
  const where = [];
  const params = [];
  if (search) {
    params.push(`%${search}%`);
    const i = params.length;
    where.push(`(vm_name ILIKE $${i} OR os_hostname ILIKE $${i} OR ip_address ILIKE $${i} OR assigned_user ILIKE $${i} OR department ILIKE $${i})`);
  }
  if (osType)       { params.push(osType);       where.push(`os_type = $${params.length}`); }
  if (serverStatus) { params.push(serverStatus); where.push(`server_status = $${params.length}`); }
  if (location)     { params.push(location);     where.push(`location = $${params.length}`); }
  if (eolStatus)    { params.push(eolStatus);    where.push(`eol_status = $${params.length}`); }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const safeSort = ['vm_name','ip_address','os_type','server_status','location','eol_status','created_at','updated_at'].includes(sortBy) ? sortBy : 'created_at';
  const safeDir = String(sortDir).toLowerCase() === 'asc' ? 'ASC' : 'DESC';
  const offset = (page - 1) * pageSize;

  const [items, count] = await Promise.all([
    db.query(
      `SELECT a.*,
              u.full_name  AS created_by_name,
              u2.full_name AS updated_by_name
         FROM ${TABLE} a
         LEFT JOIN users u  ON u.id  = a.created_by
         LEFT JOIN users u2 ON u2.id = a.updated_by
         ${whereSql}
       ORDER BY a.${safeSort} ${safeDir}
       LIMIT ${pageSize} OFFSET ${offset}`,
      params
    ),
    db.query(`SELECT COUNT(*)::int AS c FROM ${TABLE} ${whereSql}`, params),
  ]);

  return {
    items: items.rows.map(scrub),
    total: count.rows[0].c,
    page,
    pageSize,
  };
}

function scrub(row) {
  const { asset_password_encrypted, ...rest } = row;
  return { ...rest, hasPassword: !!asset_password_encrypted };
}

async function tagStats(department) {
  return deptSvc.tagStats(department);
}

module.exports = {
  create, update, remove, get, list, viewPassword,
  ASSET_COLUMNS,
  TABLE,
  tagStats,
};
