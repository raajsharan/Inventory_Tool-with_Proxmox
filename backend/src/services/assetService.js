const db = require('../config/db');
const crypto = require('../utils/crypto');
const ApiError = require('../utils/ApiError');
const deptSvc = require('./departmentService');
const decomSvc = require('./decommissionService');

const ASSET_COLUMNS = [
  'vm_name','os_hostname','ip_address','asset_type','os_type','os_version',
  'assigned_user','department','business_purpose','server_status','patching_type',
  'server_patch_type','patching_schedule','location','eol_status','serial_number',
  'ome_status','hosted_ip','asset_tag','asset_username','additional_remarks',
  'mac_address','manage_engine_installed','tenable_installed','idrac_enabled','idrac_ip'
];

function mapBody(body) {
  const row = {};
  for (const c of ASSET_COLUMNS) {
    const camel = c.replace(/_([a-z])/g, (_, ch) => ch.toUpperCase());
    if (body[camel] !== undefined)      row[c] = body[camel];
    else if (body[c] !== undefined)     row[c] = body[c];
  }
  const rawPw = body.assetPassword ?? body.asset_password;
  if (rawPw !== undefined && rawPw !== null && rawPw !== '') {
    row.asset_password_encrypted = crypto.encrypt(String(rawPw));
  }
  if (body.extras !== undefined) {
    row.extras = typeof body.extras === 'string' ? body.extras : JSON.stringify(body.extras || {});
  }
  return row;
}

async function checkDuplicates({ ip_address, asset_tag, excludeId }) {
  const conds = [];
  const params = [];
  if (ip_address) { params.push(ip_address); conds.push(`ip_address = $${params.length}`); }
  if (asset_tag)  { params.push(asset_tag);  conds.push(`asset_tag = $${params.length}`); }
  if (!conds.length) return;
  let sql = `SELECT ip_address, asset_tag FROM assets WHERE (${conds.join(' OR ')}) AND deleted_at IS NULL AND decommissioned_at IS NULL`;
  if (excludeId) { params.push(excludeId); sql += ` AND id <> $${params.length}`; }
  const { rows } = await db.query(sql, params);
  const dupes = {};
  for (const r of rows) {
    if (ip_address && r.ip_address === ip_address) dupes.ip_address = 'duplicate IP address';
    if (asset_tag && r.asset_tag === asset_tag) dupes.asset_tag = 'duplicate asset tag';
  }
  if (Object.keys(dupes).length) {
    throw new ApiError(409, 'Duplicate values', dupes);
  }
}

async function create(body, userId) {
  const row = mapBody(body);
  if (decomSvc.isDecomStatus(row.server_status)) {
    row.decommissioned_at = new Date();
    row.decommissioned_by = userId || null;
  }

  // Auto-assign next available tag when a department is set and no tag was supplied.
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
  await checkDuplicates({ ip_address: row.ip_address, asset_tag: row.asset_tag });
  row.created_by = userId;
  row.updated_by = userId;
  const cols = Object.keys(row);
  const vals = Object.values(row);
  const placeholders = cols.map((_, i) => `$${i + 1}`).join(',');
  const { rows } = await db.query(
    `INSERT INTO assets (${cols.join(',')}) VALUES (${placeholders}) RETURNING *`,
    vals
  );
  if (row.decommissioned_at) {
    await decomSvc.logDecommission('assets', rows[0], userId, body.decommissionReason);
  }
  return scrub(rows[0]);
}

async function update(id, body, userId) {
  const row = mapBody(body);
  if (!Object.keys(row).length) throw new ApiError(400, 'No fields to update');
  const existingQ = await db.query(`SELECT department, asset_tag, ip_address, decommissioned_at FROM assets WHERE id = $1`, [id]);
  if (!existingQ.rows.length) throw new ApiError(404, 'Asset not found');
  const existing = existingQ.rows[0];
  if (row.department !== undefined || row.asset_tag !== undefined) {
    const effDept = row.department !== undefined ? row.department : existing.department;
    const effTag  = row.asset_tag  !== undefined ? row.asset_tag  : existing.asset_tag;
    await deptSvc.validateDepartmentTag(effDept, effTag);
  }
  // Cross-inventory duplicate checks apply only to CHANGED values —
  // a record must stay editable even if its existing IP/tag historically
  // duplicates another inventory.
  const tagChanged = row.asset_tag  !== undefined && String(row.asset_tag)  !== String(existing.asset_tag ?? '');
  const ipChanged  = row.ip_address !== undefined && String(row.ip_address) !== String(existing.ip_address ?? '');
  if (tagChanged && row.asset_tag && await deptSvc.isTagUsedAnywhere(row.asset_tag, { excludeTable: 'assets', excludeId: id })) {
    throw new ApiError(409, 'Duplicate values', { asset_tag: 'asset tag already used in another inventory' });
  }
  if (ipChanged && row.ip_address && await deptSvc.isIpUsedAnywhere(row.ip_address, { excludeTable: 'assets', excludeId: id })) {
    throw new ApiError(409, 'Duplicate values', { ip_address: 'IP address already used in another inventory' });
  }
  await checkDuplicates({
    ip_address: ipChanged  ? row.ip_address : undefined,
    asset_tag:  tagChanged ? row.asset_tag  : undefined,
    excludeId: id,
  });
  // ── decommission lifecycle ─────────────────────────────────────────
  let decomEvent = null; // 'decommission' | 'reactivate'
  if (row.server_status !== undefined) {
    const nowDecom = decomSvc.isDecomStatus(row.server_status);
    if (nowDecom && !existing.decommissioned_at) {
      row.decommissioned_at = new Date();
      row.decommissioned_by = userId || null;
      decomEvent = 'decommission';
    } else if (!nowDecom && existing.decommissioned_at) {
      // Reactivation — the released IP/tag may have been reused since.
      const effTag = row.asset_tag  !== undefined ? row.asset_tag  : existing.asset_tag;
      const effIp  = row.ip_address !== undefined ? row.ip_address : existing.ip_address;
      if (effTag && await deptSvc.isTagUsedAnywhere(effTag, { excludeTable: 'assets', excludeId: id })) {
        throw new ApiError(409, 'Cannot reactivate', { asset_tag: `asset tag ${effTag} has been reused by an active record — assign a new tag first` });
      }
      if (effIp && await deptSvc.isIpUsedAnywhere(effIp, { excludeTable: 'assets', excludeId: id })) {
        throw new ApiError(409, 'Cannot reactivate', { ip_address: `IP ${effIp} has been reused by an active record` });
      }
      await checkDuplicates({ ip_address: effIp, asset_tag: effTag, excludeId: id });
      row.decommissioned_at = null;
      row.decommissioned_by = null;
      decomEvent = 'reactivate';
    }
  }

  row.updated_by = userId;
  const cols = Object.keys(row);
  const vals = Object.values(row);
  const set = cols.map((c, i) => `${c} = $${i + 1}`).join(',');
  vals.push(id);
  const { rows } = await db.query(
    `UPDATE assets SET ${set} WHERE id = $${vals.length} RETURNING *`,
    vals
  );
  if (!rows.length) throw new ApiError(404, 'Asset not found');
  if (decomEvent === 'decommission') {
    await decomSvc.logDecommission('assets', rows[0], userId, body.decommissionReason);
  } else if (decomEvent === 'reactivate') {
    await decomSvc.logReactivation('assets', id, userId);
  }
  return scrub(rows[0]);
}

async function remove(id, userId) {
  // Soft-delete so the row lands in the Recycle Bin. Frees up partial
  // unique indexes on vm_name / ip_address / asset_tag for reuse.
  const { rowCount } = await db.query(
    `UPDATE assets SET deleted_at = NOW(), deleted_by = $2
       WHERE id = $1 AND deleted_at IS NULL`,
    [id, userId || null]
  );
  if (!rowCount) throw new ApiError(404, 'Asset not found');
}

async function get(id) {
  const { rows } = await db.query(
    `SELECT a.*,
            u.full_name  AS created_by_name,
            u2.full_name AS updated_by_name
       FROM assets a
       LEFT JOIN users u  ON u.id  = a.created_by
       LEFT JOIN users u2 ON u2.id = a.updated_by
      WHERE a.id = $1 AND a.deleted_at IS NULL`,
    [id]
  );
  if (!rows.length) throw new ApiError(404, 'Asset not found');
  return scrub(rows[0]);
}

async function viewPassword(id) {
  const { rows } = await db.query(`SELECT asset_password_encrypted FROM assets WHERE id = $1`, [id]);
  if (!rows.length) throw new ApiError(404, 'Asset not found');
  if (!rows[0].asset_password_encrypted) return null;
  return crypto.decrypt(rows[0].asset_password_encrypted);
}

async function list({ search, osType, serverStatus, location, eolStatus, department, page = 1, pageSize = 20, sortBy = 'created_at', sortDir = 'desc' }) {
  const where = ['a.deleted_at IS NULL', 'a.decommissioned_at IS NULL'];
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
  if (department)   { params.push(department);   where.push(`department = $${params.length}`); }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const safeSort = ['vm_name','ip_address','os_type','server_status','location','eol_status','created_at','updated_at'].includes(sortBy) ? sortBy : 'created_at';
  const safeDir = String(sortDir).toLowerCase() === 'asc' ? 'ASC' : 'DESC';
  const offset = (page - 1) * pageSize;

  const [items, count] = await Promise.all([
    db.query(
      `SELECT a.*,
              u.full_name  AS created_by_name,
              u2.full_name AS updated_by_name
         FROM assets a
         LEFT JOIN users u  ON u.id  = a.created_by
         LEFT JOIN users u2 ON u2.id = a.updated_by
         ${whereSql}
       ORDER BY a.${safeSort} ${safeDir}
       LIMIT ${pageSize} OFFSET ${offset}`,
      params
    ),
    db.query(`SELECT COUNT(*)::int AS c FROM assets a ${whereSql}`, params),
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

module.exports = {
  create, update, remove, get, list, viewPassword,
  ASSET_COLUMNS,
  tagStats: deptSvc.tagStats,
  validateDepartmentTag: deptSvc.validateDepartmentTag,
};
