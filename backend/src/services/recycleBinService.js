const db = require('../config/db');
const ApiError = require('../utils/ApiError');

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
      `SELECT a.id, a.vm_name AS name, a.ip_address AS ip, a.asset_tag AS tag,
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

module.exports = { list, restore, purge, emptyAll, TABLE_BY_TYPE };
