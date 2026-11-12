const db = require('../config/db');
const ApiError = require('../utils/ApiError');
const deptSvc = require('./departmentService');

// Maps a logical "type" the UI uses to the underlying physical table.
const TABLE_BY_TYPE = {
  assets:                'assets',
  beijing_assets:        'beijing_assets',
  ext_assets:            'ext_assets',
  physical_esxi_servers: 'physical_esxi_servers',
  custom_page_records:   'custom_page_records',
};

function assertType(type) {
  if (!TABLE_BY_TYPE[type]) throw new ApiError(400, `Unknown recycle bin type: ${type}`);
  return TABLE_BY_TYPE[type];
}

// Fetch deleted rows across every supported table. Each row carries
// the same shape: { id, type, name, ip, tag, page_name, page_slug,
// deleted_at, deleted_by_name }.
async function list({ type, search } = {}) {
  const q = (search || '').trim().toLowerCase();
  const out = [];

  const invTypes = ['assets', 'beijing_assets', 'ext_assets', 'physical_esxi_servers'];
  for (const t of invTypes) {
    if (type && type !== t) continue;
    const { rows } = await db.query(
      `SELECT a.id, a.vm_name AS name, a.ip_address AS ip, a.asset_tag AS tag, a.location,
              a.deleted_at, u.full_name AS deleted_by_name
         FROM ${t} a
         LEFT JOIN users u ON u.id = a.deleted_by
        WHERE a.deleted_at IS NOT NULL
        ORDER BY a.deleted_at DESC`
    );
    for (const r of rows) {
      out.push({
        type: t,
        id: r.id,
        name: r.name,
        ip: r.ip,
        tag: r.tag,
        location: r.location,
        deleted_at: r.deleted_at,
        deleted_by_name: r.deleted_by_name,
      });
    }
  }

  if (!type || type === 'custom_page_records') {
    const { rows } = await db.query(
      `SELECT r.id, r.data, r.deleted_at,
              u.full_name AS deleted_by_name,
              p.name AS page_name, p.slug AS page_slug
         FROM custom_page_records r
         JOIN custom_pages p ON p.id = r.page_id
         LEFT JOIN users u  ON u.id = r.deleted_by
        WHERE r.deleted_at IS NOT NULL
        ORDER BY r.deleted_at DESC`
    );
    for (const r of rows) {
      const data = typeof r.data === 'string' ? JSON.parse(r.data) : (r.data || {});
      const candidateName =
        data.vm_name || data.name || data.title || data.label ||
        data.hostname || data.identifier || `Record ${r.id.slice(0, 8)}`;
      out.push({
        type: 'custom_page_records',
        id: r.id,
        name: String(candidateName),
        page_name: r.page_name,
        page_slug: r.page_slug,
        deleted_at: r.deleted_at,
        deleted_by_name: r.deleted_by_name,
      });
    }
  }

  let filtered = out.sort((a, b) => new Date(b.deleted_at) - new Date(a.deleted_at));
  if (q) {
    filtered = filtered.filter(r =>
      [r.name, r.ip, r.tag, r.page_name, r.deleted_by_name]
        .filter(Boolean).some(v => String(v).toLowerCase().includes(q))
    );
  }
  return filtered;
}

async function restore(type, id, userId) {
  const table = assertType(type);

  // The IP/asset tag freed up when this row was deleted may have since
  // been reused by another active record. Partial unique indexes would
  // catch that at the UPDATE below, but only with a generic 409 — check
  // up front so we can name the specific conflicting field instead, same
  // as assetService.update()'s reactivation path.
  if (deptSvc.ALL_TABLES.includes(table)) {
    const { rows } = await db.query(
      `SELECT ip_address, asset_tag FROM ${table} WHERE id = $1 AND deleted_at IS NOT NULL`,
      [id]
    );
    if (!rows.length) throw new ApiError(404, 'Item not found in recycle bin');
    const { ip_address: ip, asset_tag: tag } = rows[0];
    if (tag && await deptSvc.isTagUsedAnywhere(tag, { excludeTable: table, excludeId: id })) {
      throw new ApiError(409, 'Cannot restore', { asset_tag: `asset tag ${tag} has been reused by an active record — assign a new tag first` });
    }
    if (ip && await deptSvc.isIpUsedAnywhere(ip, { excludeTable: table, excludeId: id })) {
      throw new ApiError(409, 'Cannot restore', { ip_address: `IP ${ip} has been reused by an active record` });
    }
  }

  const { rowCount } = await db.query(
    `UPDATE ${table} SET deleted_at = NULL, deleted_by = NULL, updated_by = $2, updated_at = NOW()
       WHERE id = $1 AND deleted_at IS NOT NULL`,
    [id, userId || null]
  );
  if (!rowCount) throw new ApiError(404, 'Item not found in recycle bin');
  return { ok: true };
}

async function purge(type, id) {
  const table = assertType(type);
  const { rowCount } = await db.query(
    `DELETE FROM ${table} WHERE id = $1 AND deleted_at IS NOT NULL`,
    [id]
  );
  if (!rowCount) throw new ApiError(404, 'Item not found in recycle bin');
  return { ok: true };
}

async function emptyAll() {
  const counts = {};
  for (const [type, table] of Object.entries(TABLE_BY_TYPE)) {
    const { rowCount } = await db.query(
      `DELETE FROM ${table} WHERE deleted_at IS NOT NULL`
    );
    counts[type] = rowCount;
  }
  return counts;
}

// Permanently deletes every recycle-bin row whose location matches, within the
// given inventory types (custom page records have no location, so they are never
// included). '(blank)' targets rows with an empty location. Only rows already in
// the bin (deleted_at IS NOT NULL) can be touched.
async function purgeByLocation({ types, location }) {
  const inv = ['assets', 'beijing_assets', 'ext_assets', 'physical_esxi_servers'];
  const list = (Array.isArray(types) && types.length ? types : inv).filter(t => inv.includes(t));
  if (!list.length) throw new ApiError(400, 'No valid inventory selected');
  const loc = String(location ?? '').trim();
  if (!loc) throw new ApiError(400, 'Location is required');
  const blank = loc === '(blank)';
  const counts = {};
  for (const t of list) {
    const { rowCount } = await db.query(
      blank
        ? `DELETE FROM ${TABLE_BY_TYPE[t]} WHERE deleted_at IS NOT NULL AND COALESCE(TRIM(location), '') = ''`
        : `DELETE FROM ${TABLE_BY_TYPE[t]} WHERE deleted_at IS NOT NULL AND location = $1`,
      blank ? [] : [loc]
    );
    counts[t] = rowCount;
  }
  return counts;
}

module.exports = { list, restore, purge, emptyAll, purgeByLocation, TABLE_BY_TYPE };
