const bcrypt = require('bcrypt');
const db = require('../config/db');
const ApiError = require('../utils/ApiError');
const customRolesSvc = require('../services/customRolesService');

const SYSTEM_VISIBLE = ['admin', 'asset_manager', 'viewer'];
const SYSTEM_ALL     = ['superadmin', ...SYSTEM_VISIBLE];

// Build the live allowed-role list (system + custom) for the request's privilege level
async function getAllowedRoles(isSuperUser) {
  const custom = await customRolesSvc.listCustom().then(rows => rows.map(r => r.name));
  return isSuperUser
    ? [...SYSTEM_ALL, ...custom]
    : [...SYSTEM_VISIBLE, ...custom];
}

function isSuper(req) { return req.user?.role === 'superadmin'; }

async function list(req, res, next) {
  try {
    const whereSql = isSuper(req) ? '' : `WHERE role <> 'superadmin'`;
    const { rows } = await db.query(
      `SELECT id, email, full_name, role, is_active, last_login_at, created_at
         FROM users ${whereSql}
        ORDER BY created_at DESC`
    );
    res.json({ items: rows });
  } catch (e) { next(e); }
}

async function create(req, res, next) {
  try {
    const { email, fullName, password, role } = req.body;
    if (!email || !password || !fullName || !role) throw new ApiError(400, 'Missing fields');
    const allowed = await getAllowedRoles(isSuper(req));
    if (!allowed.includes(role)) throw new ApiError(400, 'Invalid role');
    const hash = await bcrypt.hash(password, 12);
    const { rows } = await db.query(
      `INSERT INTO users (email, full_name, password_hash, role)
       VALUES ($1,$2,$3,$4) RETURNING id, email, full_name, role, is_active, created_at`,
      [email.toLowerCase(), fullName, hash, role]
    );
    res.status(201).json(rows[0]);
  } catch (e) {
    if (e.code === '23505') return next(new ApiError(409, 'Email already exists'));
    next(e);
  }
}

async function targetIsSuperadmin(id) {
  const { rows } = await db.query(`SELECT role FROM users WHERE id = $1`, [id]);
  return rows[0]?.role === 'superadmin';
}

async function update(req, res, next) {
  try {
    if (!isSuper(req) && await targetIsSuperadmin(req.params.id)) {
      // Hide the superadmin row from non-superadmins entirely.
      throw new ApiError(404, 'User not found');
    }
    const { fullName, role, isActive, password } = req.body;
    if (role !== undefined) {
      if (role === 'superadmin' && !isSuper(req)) {
        throw new ApiError(403, 'Only superadmin can assign the superadmin role');
      }
      const allowed = await getAllowedRoles(isSuper(req));
      if (!allowed.includes(role)) throw new ApiError(400, 'Invalid role');
    }
    const sets = [];
    const params = [];
    if (fullName !== undefined) { params.push(fullName); sets.push(`full_name = $${params.length}`); }
    if (role !== undefined)     { params.push(role);     sets.push(`role = $${params.length}`); }
    if (isActive !== undefined) { params.push(isActive); sets.push(`is_active = $${params.length}`); }
    if (password) {
      const hash = await bcrypt.hash(password, 12);
      params.push(hash); sets.push(`password_hash = $${params.length}`);
    }
    if (!sets.length) throw new ApiError(400, 'No fields to update');
    params.push(req.params.id);
    const { rows } = await db.query(
      `UPDATE users SET ${sets.join(',')} WHERE id = $${params.length}
       RETURNING id, email, full_name, role, is_active, last_login_at, created_at`,
      params
    );
    if (!rows.length) throw new ApiError(404, 'User not found');
    res.json(rows[0]);
  } catch (e) { next(e); }
}

async function remove(req, res, next) {
  try {
    if (!isSuper(req) && await targetIsSuperadmin(req.params.id)) {
      throw new ApiError(404, 'User not found');
    }
    const { rowCount } = await db.query(`DELETE FROM users WHERE id = $1`, [req.params.id]);
    if (!rowCount) throw new ApiError(404, 'User not found');
    res.status(204).end();
  } catch (e) { next(e); }
}

module.exports = { list, create, update, remove };
