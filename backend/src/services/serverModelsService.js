const db = require('../config/db');
const ApiError = require('../utils/ApiError');

async function list() {
  const { rows } = await db.query(`
    SELECT
      sm.id,
      sm.manufacturer,
      sm.model_name,
      sm.notes,
      sm.created_at,
      sm.updated_at,
      COUNT(pe.id)::int AS servers_using
    FROM server_models sm
    LEFT JOIN physical_esxi_servers pe
           ON pe.server_model = sm.model_name
          AND pe.deleted_at       IS NULL
          AND pe.decommissioned_at IS NULL
    GROUP BY sm.id
    ORDER BY sm.manufacturer NULLS LAST, sm.model_name
  `);
  return rows;
}

async function create({ manufacturer, model_name, notes }) {
  if (!model_name?.trim()) throw new ApiError(400, 'Model name is required');
  try {
    const { rows } = await db.query(
      `INSERT INTO server_models (manufacturer, model_name, notes)
       VALUES ($1, $2, $3) RETURNING *`,
      [manufacturer?.trim() || null, model_name.trim(), notes?.trim() || null]
    );
    return { ...rows[0], servers_using: 0 };
  } catch (e) {
    if (e.code === '23505') throw new ApiError(409, 'A model with that name already exists');
    throw e;
  }
}

async function update(id, { manufacturer, model_name, notes }) {
  if (!model_name?.trim()) throw new ApiError(400, 'Model name is required');
  const oldRow = await db.query('SELECT model_name FROM server_models WHERE id = $1', [id]);
  if (!oldRow.rows.length) throw new ApiError(404, 'Model not found');
  const oldName = oldRow.rows[0].model_name;
  const newName = model_name.trim();

  // Update the name reference in physical_esxi_servers when model_name changes
  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    if (oldName !== newName) {
      await client.query(
        `UPDATE physical_esxi_servers SET server_model = $1 WHERE server_model = $2`,
        [newName, oldName]
      );
    }
    const { rows } = await client.query(
      `UPDATE server_models
          SET manufacturer = $1, model_name = $2, notes = $3, updated_at = NOW()
        WHERE id = $4
       RETURNING *`,
      [manufacturer?.trim() || null, newName, notes?.trim() || null, id]
    );
    if (!rows.length) throw new ApiError(404, 'Model not found');
    await client.query('COMMIT');
    return rows[0];
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally { client.release(); }
}

async function remove(id) {
  const check = await db.query(
    `SELECT COUNT(pe.id)::int AS cnt
       FROM server_models sm
       LEFT JOIN physical_esxi_servers pe
              ON pe.server_model = sm.model_name
             AND pe.deleted_at IS NULL AND pe.decommissioned_at IS NULL
      WHERE sm.id = $1`,
    [id]
  );
  if (!check.rows.length) throw new ApiError(404, 'Model not found');
  if (check.rows[0].cnt > 0) {
    throw new ApiError(409, `Cannot delete — ${check.rows[0].cnt} server(s) still reference this model`);
  }
  await db.query('DELETE FROM server_models WHERE id = $1', [id]);
}

module.exports = { list, create, update, remove };
