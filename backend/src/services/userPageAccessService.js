const db = require('../config/db');

async function listUsersWithAccess() {
  const [usersRes, accessRes] = await Promise.all([
    db.query(
      `SELECT id, email, full_name, role, is_active, can_view_passwords
         FROM users
        WHERE role <> 'superadmin'
        ORDER BY role, full_name`
    ),
    db.query(`SELECT user_id, page_key, allowed FROM user_page_access`),
  ]);

  const accessMap = {};
  for (const a of accessRes.rows) {
    if (!accessMap[a.user_id]) accessMap[a.user_id] = {};
    accessMap[a.user_id][a.page_key] = a.allowed;
  }

  return usersRes.rows.map(u => ({
    ...u,
    page_access: accessMap[u.id] || {},
  }));
}

async function getMyAccess(userId) {
  const [userRes, accessRes] = await Promise.all([
    db.query(`SELECT can_view_passwords FROM users WHERE id = $1`, [userId]),
    db.query(`SELECT page_key, allowed FROM user_page_access WHERE user_id = $1`, [userId]),
  ]);
  const pageAccess = {};
  for (const r of accessRes.rows) pageAccess[r.page_key] = r.allowed;
  return {
    can_view_passwords: userRes.rows[0]?.can_view_passwords ?? false,
    page_access: pageAccess,
  };
}

async function saveUserAccess(userId, { can_view_passwords, page_access }, updatedBy) {
  const client = await db.getClient();
  try {
    await client.query('BEGIN');

    await client.query(
      `UPDATE users SET can_view_passwords = $1 WHERE id = $2`,
      [!!can_view_passwords, userId]
    );

    if (page_access && typeof page_access === 'object') {
      for (const [pageKey, allowed] of Object.entries(page_access)) {
        await client.query(
          `INSERT INTO user_page_access (user_id, page_key, allowed, updated_by, updated_at)
           VALUES ($1,$2,$3,$4,NOW())
           ON CONFLICT (user_id, page_key) DO UPDATE
             SET allowed = EXCLUDED.allowed,
                 updated_by = EXCLUDED.updated_by,
                 updated_at = NOW()`,
          [userId, pageKey, !!allowed, updatedBy]
        );
      }
    }

    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

module.exports = { listUsersWithAccess, getMyAccess, saveUserAccess };
