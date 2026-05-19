const db = require('../config/db');
const fieldVis = require('./fieldVisibilityService');

const ROLES = ['admin', 'asset_manager', 'viewer'];

// Static (built-in) page registry. Custom-page entries are appended dynamically.
const STATIC_PAGES = [
  { key: 'dashboard',             label: 'Dashboard',                group: 'General' },
  { key: 'assets',                label: 'Asset Inventory',          group: 'Inventory' },
  { key: 'beijing_assets',        label: 'Beijing Assets',           group: 'Inventory' },
  { key: 'ext_assets',            label: 'Ext. Assets',              group: 'Inventory' },
  { key: 'physical_esxi_servers', label: 'Physical & ESXi Servers',  group: 'Inventory' },
  { key: 'reports',               label: 'Report Builder',           group: 'General' },
  { key: 'admin/users',           label: 'Users',                    group: 'Administration' },
  { key: 'admin/dropdowns',       label: 'Dropdowns',                group: 'Administration' },
  { key: 'admin/tag-ranges',      label: 'Tag Ranges',               group: 'Administration' },
  { key: 'admin/custom-pages',    label: 'Custom Pages',             group: 'Administration' },
  { key: 'admin/field-visibility',label: 'Field Customization',      group: 'Administration' },
  { key: 'admin/page-access',     label: 'Page Access',              group: 'Administration' },
  { key: 'admin/backup',          label: 'Backup / Export & Import', group: 'Administration' },
  { key: 'admin/imports',         label: 'Import History',           group: 'Administration' },
  { key: 'admin/audit',           label: 'Audit Log',                group: 'Administration' },
];

async function dynamicCustomPages() {
  const { rows } = await db.query(
    `SELECT slug, name FROM custom_pages WHERE is_active = TRUE ORDER BY created_at ASC`
  );
  return rows.map(r => ({ key: `custom:${r.slug}`, label: r.name, group: 'Custom Pages' }));
}

async function listPages() {
  const customs = await dynamicCustomPages();
  return [...STATIC_PAGES, ...customs];
}

async function loadMatrix() {
  const { rows } = await db.query(
    `SELECT page_key, role, allowed FROM page_access`
  );
  const out = {};
  for (const r of rows) out[`${r.page_key}:${r.role}`] = r.allowed;
  return out;
}

async function list() {
  const [pages, matrix] = await Promise.all([listPages(), loadMatrix()]);
  return { pages, roles: ROLES, matrix };
}

async function setMatrix(updates, userId) {
  // updates: [{ page_key, role, allowed }]
  if (!Array.isArray(updates) || !updates.length) return await list();
  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    for (const u of updates) {
      if (!u || typeof u.page_key !== 'string' || !ROLES.includes(u.role)) continue;
      await client.query(
        `INSERT INTO page_access (page_key, role, allowed, updated_by, updated_at)
         VALUES ($1, $2, $3, $4, NOW())
         ON CONFLICT (page_key, role) DO UPDATE
           SET allowed = EXCLUDED.allowed,
               updated_by = EXCLUDED.updated_by,
               updated_at = NOW()`,
        [u.page_key, u.role, !!u.allowed, userId || null]
      );
    }
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally { client.release(); }
  return list();
}

// Check whether `role` may access `pageKey`. Superadmin always true. Default
// true when no row exists (open by default).
async function can(role, pageKey) {
  if (role === 'superadmin') return true;
  if (!role || !pageKey) return false;
  const { rows } = await db.query(
    `SELECT allowed FROM page_access WHERE page_key = $1 AND role = $2`,
    [pageKey, role]
  );
  if (!rows.length) return true;
  return !!rows[0].allowed;
}

module.exports = {
  ROLES,
  STATIC_PAGES,
  fieldVisPages: fieldVis.PAGES,
  listPages,
  list,
  setMatrix,
  can,
};
