const db = require('../config/db');
const ApiError = require('../utils/ApiError');

const SYSTEM_ROLE_NAMES = ['superadmin', 'admin', 'asset_manager', 'viewer'];

async function listCustom() {
  const { rows } = await db.query(`
    SELECT cr.id, cr.name, cr.label, cr.description, cr.created_at, cr.updated_at,
           COUNT(u.id)::int AS user_count
      FROM custom_roles cr
      LEFT JOIN users u ON u.role = cr.name
      GROUP BY cr.id
      ORDER BY cr.created_at
  `);
  return rows;
}

// Returns all role names including custom ones (used by userController validation)
async function allAllowedNames() {
  const { rows } = await db.query(`SELECT name FROM custom_roles`);
  return [...SYSTEM_ROLE_NAMES, ...rows.map(r => r.name)];
}

async function create({ name, label, description }, createdBy) {
  if (!name || !label) throw new ApiError(400, 'name and label are required');
  if (SYSTEM_ROLE_NAMES.includes(name)) throw new ApiError(409, 'Cannot reuse a system role name');
  if (!/^[a-z0-9_]+$/.test(name)) throw new ApiError(400, 'name must be lowercase letters, digits and underscores only');
  const { rows } = await db.query(
    `INSERT INTO custom_roles (name, label, description, created_by)
     VALUES ($1,$2,$3,$4) RETURNING *`,
    [name, label, description || null, createdBy]
  );
  return rows[0];
}

async function update(id, { label, description }) {
  if (!label) throw new ApiError(400, 'label is required');
  const { rows } = await db.query(
    `UPDATE custom_roles SET label=$1, description=$2, updated_at=NOW()
      WHERE id=$3 RETURNING *`,
    [label, description || null, id]
  );
  if (!rows.length) throw new ApiError(404, 'Role not found');
  return rows[0];
}

async function remove(id) {
  const { rows: cr } = await db.query(`SELECT name FROM custom_roles WHERE id=$1`, [id]);
  if (!cr.length) throw new ApiError(404, 'Role not found');
  const { rows: cnt } = await db.query(`SELECT COUNT(*)::int AS c FROM users WHERE role=$1`, [cr[0].name]);
  if (cnt[0].c > 0) throw new ApiError(409, `Cannot delete: ${cnt[0].c} user(s) still have this role`);
  await db.query(`DELETE FROM custom_roles WHERE id=$1`, [id]);
}

async function getSystemOverrides() {
  const { rows } = await db.query('SELECT name, label, description FROM system_role_overrides');
  return Object.fromEntries(rows.map(r => [r.name, r]));
}

async function upsertSystemOverride(name, { label, description }, updatedBy) {
  if (!SYSTEM_ROLE_NAMES.includes(name)) throw new ApiError(400, 'Not a system role');
  if (!label) throw new ApiError(400, 'label is required');
  const { rows } = await db.query(
    `INSERT INTO system_role_overrides (name, label, description, updated_by, updated_at)
     VALUES ($1, $2, $3, $4, NOW())
     ON CONFLICT (name) DO UPDATE
       SET label       = EXCLUDED.label,
           description = EXCLUDED.description,
           updated_by  = EXCLUDED.updated_by,
           updated_at  = NOW()
     RETURNING *`,
    [name, label, description || null, updatedBy || null]
  );
  return rows[0];
}

module.exports = { listCustom, allAllowedNames, create, update, remove, getSystemOverrides, upsertSystemOverride, SYSTEM_ROLE_NAMES };
