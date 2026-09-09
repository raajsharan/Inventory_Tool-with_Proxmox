const db = require('../config/db');
const crypto = require('../utils/crypto');

async function get(userId, linkKey) {
  const { rows } = await db.query(
    `SELECT username, password_encrypted FROM external_link_credentials WHERE user_id = $1 AND link_key = $2`,
    [userId, linkKey],
  );
  const row = rows[0];
  if (!row || !row.username) return null;
  return { username: row.username, password: crypto.decryptSafe(row.password_encrypted) };
}

async function save(userId, linkKey, { username, password }) {
  await db.query(
    `INSERT INTO external_link_credentials (user_id, link_key, username, password_encrypted, updated_at)
     VALUES ($1, $2, $3, $4, NOW())
     ON CONFLICT (user_id, link_key) DO UPDATE
       SET username = EXCLUDED.username,
           password_encrypted = EXCLUDED.password_encrypted,
           updated_at = NOW()`,
    [userId, linkKey, username, crypto.encrypt(password)],
  );
  return get(userId, linkKey);
}

async function remove(userId, linkKey) {
  await db.query(`DELETE FROM external_link_credentials WHERE user_id = $1 AND link_key = $2`, [userId, linkKey]);
}

module.exports = { get, save, remove };
