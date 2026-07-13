const db = require('../config/db');
const fieldVis = require('./fieldVisibilityService');

const STATIC_ROLE_NAMES = ['admin', 'asset_manager', 'viewer'];

// Returns static roles + any custom roles created by admins
async function getActiveRoles() {
  const { rows } = await db.query(`SELECT name FROM custom_roles ORDER BY created_at`);
  return [...STATIC_ROLE_NAMES, ...rows.map(r => r.name)];
}

// Keep ROLES exported for backward-compat (static only)
const ROLES = STATIC_ROLE_NAMES;

// Static (built-in) page registry. Custom-page entries are appended dynamically.
const STATIC_PAGES = [
  { key: 'dashboard',             label: 'Dashboard',                group: 'General' },
  { key: 'assets',                label: 'Asset Inventory',          group: 'Inventory' },
  { key: 'beijing_assets',        label: 'Beijing Assets',           group: 'Inventory' },
  { key: 'ext_assets',            label: 'Ext. Assets',              group: 'Inventory' },
  { key: 'physical_esxi_servers', label: 'Physical & ESXi Servers',  group: 'Inventory' },
  { key: 'decommissioned',        label: 'Decommissioned',           group: 'Inventory' },
  { key: 'reports',               label: 'Report Builder',           group: 'General' },
  { key: 'admin/users',           label: 'Users',                    group: 'Administration' },
  { key: 'admin/dropdowns',       label: 'Dropdowns',                group: 'Administration' },
  { key: 'admin/server-models',  label: 'Server Models',            group: 'Administration' },
  { key: 'admin/tag-ranges',      label: 'Tag Ranges',               group: 'Administration' },
  { key: 'admin/custom-pages',    label: 'Custom Pages',             group: 'Administration' },
  { key: 'admin/field-visibility',label: 'Field Customization',      group: 'Administration' },
  { key: 'admin/page-access',     label: 'Page Access',              group: 'Administration' },
  { key: 'admin/backup',          label: 'Backup / Export & Import', group: 'Administration' },
  { key: 'admin/branding',        label: 'Branding & Customization', group: 'Administration' },
  { key: 'admin/recycle-bin',     label: 'Recycle Bin',              group: 'Administration' },
  { key: 'admin/data-health',     label: 'Data Health',              group: 'Administration' },
  { key: 'admin/dashboard-settings', label: 'Dashboard Settings',    group: 'Administration' },
  { key: 'admin/compliance-config',   label: 'Compliance Config',     group: 'Administration' },
  { key: 'admin/migration-config',   label: 'Migration Config',      group: 'Administration' },
  { key: 'admin/imports',         label: 'Import History',           group: 'Administration' },
  { key: 'admin/audit',           label: 'Audit Log',                group: 'Administration' },
  { key: 'admin/nav-order',          label: 'Menu Order',               group: 'Administration' },
  { key: 'admin/user-page-control', label: 'User Page Control',        group: 'Administration' },
  { key: 'admin/roles',             label: 'Role Management',           group: 'Administration' },
  { key: 'software_status',         label: 'Software Status (ManageEngine)', group: 'General' },
  { key: 'nessus_status',           label: 'Software Status (Nessus)',       group: 'General' },
  { key: 'tenable_report',          label: 'Tenable Report',                 group: 'General' },
  { key: 'migration_tracker',       label: 'Migration Tracker',              group: 'General' },
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
  const [pages, matrix, activeRoles] = await Promise.all([listPages(), loadMatrix(), getActiveRoles()]);
  return { pages, roles: activeRoles, matrix };
}

async function setMatrix(updates, userId) {
  // updates: [{ page_key, role, allowed }]
  if (!Array.isArray(updates) || !updates.length) return await list();
  const activeRoles = await getActiveRoles();
  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    for (const u of updates) {
      if (!u || typeof u.page_key !== 'string' || !activeRoles.includes(u.role)) continue;
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

// Per-user check: a user_page_access row takes precedence over the role
// matrix; falls back to can(role, pageKey) when no override exists.
async function canUser(userId, role, pageKey) {
  if (role === 'superadmin') return true;
  if (!pageKey) return false;
  if (userId) {
    const { rows } = await db.query(
      `SELECT allowed FROM user_page_access WHERE user_id = $1 AND page_key = $2`,
      [userId, pageKey]
    );
    if (rows.length) return !!rows[0].allowed;
  }
  return can(role, pageKey);
}

module.exports = {
  ROLES,
  STATIC_PAGES,
  fieldVisPages: fieldVis.PAGES,
  listPages,
  list,
  setMatrix,
  can,
  canUser,
};
