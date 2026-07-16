const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const db = require('../config/db');
const ApiError = require('../utils/ApiError');
const audit = require('../services/auditService');

// Precomputed bcrypt hash of a fixed dummy password, used to keep bcrypt.compare
// timing constant on the "no such user" / "inactive user" path so login responses
// don't leak (via response time) whether an email is registered.
const DUMMY_PASSWORD_HASH = '$2b$12$bjD8Qcyc5ml6wlVXIWNEi.WusgBc4r5jvku1AGuKh6N92kIeAKNca';

async function login(req, res, next) {
  try {
    const { email, password } = req.body;
    const { rows } = await db.query(
      `SELECT id, email, full_name, password_hash, role, is_active
         FROM users WHERE email = $1`,
      [email.toLowerCase()]
    );
    const user = rows[0];
    if (!user || !user.is_active) {
      await bcrypt.compare(password, DUMMY_PASSWORD_HASH);
      throw new ApiError(401, 'Invalid credentials');
    }

    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) throw new ApiError(401, 'Invalid credentials');

    await db.query(`UPDATE users SET last_login_at = NOW() WHERE id = $1`, [user.id]);

    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role, name: user.full_name },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '12h' }
    );

    await audit.log({
      user: { id: user.id, email: user.email },
      action: 'LOGIN',
      ipAddress: req.ip,
    });

    res.json({
      token,
      user: { id: user.id, email: user.email, fullName: user.full_name, role: user.role },
    });
  } catch (e) { next(e); }
}

async function me(req, res, next) {
  try {
    const { rows } = await db.query(
      `SELECT id, email, full_name, role, is_active, last_login_at, created_at,
              first_name, last_name, job_role, avatar_data_url
         FROM users WHERE id = $1`,
      [req.user.id]
    );
    if (!rows.length) throw new ApiError(404, 'User not found');
    const u = rows[0];
    res.json({
      user: {
        id: u.id, email: u.email, fullName: u.full_name, role: u.role,
        isActive: u.is_active, lastLoginAt: u.last_login_at, createdAt: u.created_at,
        firstName: u.first_name, lastName: u.last_name,
        jobRole: u.job_role, avatarDataUrl: u.avatar_data_url,
      },
    });
  } catch (e) { next(e); }
}

async function updateProfile(req, res, next) {
  try {
    const map = {
      firstName: 'first_name', lastName: 'last_name',
      jobRole: 'job_role', avatarDataUrl: 'avatar_data_url',
      first_name: 'first_name', last_name: 'last_name',
      job_role: 'job_role', avatar_data_url: 'avatar_data_url',
    };
    const sets = [];
    const vals = [];
    let firstName = null, lastName = null, hasName = false;
    for (const [k, v] of Object.entries(req.body || {})) {
      const col = map[k];
      if (!col) continue;
      sets.push(`${col} = $${sets.length + 1}`);
      vals.push(v);
      if (col === 'first_name') { firstName = v; hasName = true; }
      if (col === 'last_name')  { lastName  = v; hasName = true; }
    }
    if (sets.length) {
      if (hasName) {
        const composed = [firstName, lastName].filter(Boolean).join(' ').trim();
        if (composed) {
          sets.push(`full_name = $${sets.length + 1}`);
          vals.push(composed);
        }
      }
      vals.push(req.user.id);
      await db.query(`UPDATE users SET ${sets.join(', ')} WHERE id = $${vals.length}`, vals);
      await audit.log({ user: req.user, action: 'UPDATE', entityType: 'profile', entityId: req.user.id, ipAddress: req.ip });
    }
    return me(req, res, next);
  } catch (e) { next(e); }
}

async function changePassword(req, res, next) {
  try {
    const { currentPassword, newPassword } = req.body || {};
    const pwdRe = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/;
    if (!newPassword || !pwdRe.test(newPassword)) {
      throw new ApiError(400, 'Password must be at least 8 characters and include uppercase, lowercase, and a number');
    }
    const { rows } = await db.query(`SELECT password_hash FROM users WHERE id = $1`, [req.user.id]);
    if (!rows.length) throw new ApiError(404, 'User not found');
    const ok = await bcrypt.compare(currentPassword || '', rows[0].password_hash);
    if (!ok) throw new ApiError(401, 'Current password is incorrect');
    const newHash = await bcrypt.hash(newPassword, 12);
    await db.query(`UPDATE users SET password_hash = $1 WHERE id = $2`, [newHash, req.user.id]);
    await audit.log({ user: req.user, action: 'UPDATE_PASSWORD', entityType: 'user', entityId: req.user.id, ipAddress: req.ip });
    res.json({ ok: true });
  } catch (e) { next(e); }
}

module.exports = { login, me, updateProfile, changePassword };
