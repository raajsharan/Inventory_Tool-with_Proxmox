const bcrypt = require('bcrypt');
const db = require('../config/db');
const ApiError = require('./ApiError');

// Confirms the given plain-text password matches the current user's
// password_hash. Throws 401 on mismatch, 400 when no password is given.
async function verifyCurrentPassword(userId, password) {
  if (!password || typeof password !== 'string') {
    throw new ApiError(400, 'Password confirmation is required');
  }
  const { rows } = await db.query(`SELECT password_hash FROM users WHERE id = $1`, [userId]);
  if (!rows.length) throw new ApiError(404, 'User not found');
  const ok = await bcrypt.compare(password, rows[0].password_hash);
  if (!ok) throw new ApiError(401, 'Incorrect password');
}

module.exports = { verifyCurrentPassword };
