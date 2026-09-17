const db = require('../config/db');
const ApiError = require('../utils/ApiError');

const TABLE = 'custom_topology_diagrams';

// Lightweight — no nodes/edges — for the diagram picker list. Each of the
// VMware/Proxmox/Hyper-V tabs' Custom sub-tab keeps its own separate list
// of diagrams, filtered by `platform`.
async function list(platform) {
  const params = [];
  let where = '';
  if (platform) { params.push(platform); where = 'WHERE d.platform = $1'; }
  const { rows } = await db.query(
    `SELECT d.id, d.name, d.description, d.platform, d.updated_at,
            u.full_name AS updated_by_name
       FROM ${TABLE} d
       LEFT JOIN users u ON u.id = d.updated_by
       ${where}
      ORDER BY d.updated_at DESC`,
    params
  );
  return rows;
}

async function get(id) {
  const { rows } = await db.query(`SELECT * FROM ${TABLE} WHERE id = $1`, [id]);
  if (!rows.length) throw new ApiError(404, 'Diagram not found');
  return rows[0];
}

async function create({ name, description, platform }, userId) {
  if (!name || !String(name).trim()) throw new ApiError(400, 'name is required');
  const { rows } = await db.query(
    `INSERT INTO ${TABLE} (name, description, platform, created_by, updated_by)
     VALUES ($1, $2, $3, $4, $4) RETURNING *`,
    [String(name).trim(), description || null, platform || null, userId || null]
  );
  return rows[0];
}

async function update(id, { name, description, nodes, edges }, userId) {
  const { rows } = await db.query(
    `UPDATE ${TABLE} SET
        name        = COALESCE($2, name),
        description = COALESCE($3, description),
        nodes       = COALESCE($4::jsonb, nodes),
        edges       = COALESCE($5::jsonb, edges),
        updated_by  = $6,
        updated_at  = NOW()
      WHERE id = $1
    RETURNING *`,
    [
      id,
      name !== undefined ? String(name).trim() : null,
      description !== undefined ? description : null,
      nodes !== undefined ? JSON.stringify(nodes) : null,
      edges !== undefined ? JSON.stringify(edges) : null,
      userId || null,
    ]
  );
  if (!rows.length) throw new ApiError(404, 'Diagram not found');
  return rows[0];
}

async function remove(id) {
  const { rowCount } = await db.query(`DELETE FROM ${TABLE} WHERE id = $1`, [id]);
  if (!rowCount) throw new ApiError(404, 'Diagram not found');
}

module.exports = { list, get, create, update, remove };
