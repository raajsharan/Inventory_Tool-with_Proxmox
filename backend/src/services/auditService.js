const db = require('../config/db');

async function log({ user, action, entityType, entityId, details, ipAddress }) {
  try {
    await db.query(
      `INSERT INTO audit_logs (user_id, user_email, action, entity_type, entity_id, details, ip_address)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [
        user?.id || null,
        user?.email || null,
        action,
        entityType || null,
        entityId ? String(entityId) : null,
        details ? JSON.stringify(details) : null,
        ipAddress || null,
      ]
    );
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[audit] failed', e.message);
  }
}

async function list({ page = 1, pageSize = 50, action, entityType, entityId, userId, viewerRole }) {
  const where = [];
  const params = [];
  if (action)     { params.push(action);     where.push(`action = $${params.length}`); }
  if (entityType) { params.push(entityType); where.push(`entity_type = $${params.length}`); }
  if (entityId)   { params.push(String(entityId)); where.push(`entity_id = $${params.length}`); }
  if (userId)     { params.push(userId);     where.push(`user_id = $${params.length}`); }
  // Hide entries authored by superadmin from anyone who isn't superadmin.
  if (viewerRole !== 'superadmin') {
    where.push(`NOT EXISTS (SELECT 1 FROM users u WHERE u.id = audit_logs.user_id AND u.role = 'superadmin')`);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const offset = (page - 1) * pageSize;

  const [rows, count] = await Promise.all([
    db.query(
      `SELECT id, user_id, user_email, action, entity_type, entity_id, details, ip_address, created_at
         FROM audit_logs ${whereSql}
        ORDER BY created_at DESC
        LIMIT ${pageSize} OFFSET ${offset}`,
      params
    ),
    db.query(`SELECT COUNT(*)::int AS c FROM audit_logs ${whereSql}`, params),
  ]);

  return { items: rows.rows, total: count.rows[0].c, page, pageSize };
}

module.exports = { log, list };
