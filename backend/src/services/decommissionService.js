/**
 * decommissionService.js — decommission lifecycle shared by all four
 * inventory services. A record whose server_status becomes "Decommissioned"
 * is stamped (decommissioned_at/by), disappears from active views, releases
 * its IP/asset tag for reuse, and a frozen snapshot is appended to
 * decommission_log — the permanent report of who decommissioned what, when,
 * from where, and why. Reactivation clears the stamp and closes the log row.
 */
const db = require('../config/db');

const isDecomStatus = (s) => /^decom/i.test(String(s || '').trim());

async function userName(userId) {
  if (!userId) return null;
  const { rows } = await db.query(`SELECT full_name, email FROM users WHERE id = $1`, [userId]);
  return rows[0] ? (rows[0].full_name || rows[0].email) : null;
}

// Append the permanent report row. `row` is the asset row AFTER the update.
async function logDecommission(source, row, userId, reason) {
  const name = await userName(userId);
  await db.query(
    `INSERT INTO decommission_log
       (source, asset_id, vm_name, os_hostname, ip_address, asset_tag,
        serial_number, os_type, location, hosted_ip, reason,
        decommissioned_by, decommissioned_by_name)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
    [source, row.id, row.vm_name, row.os_hostname, row.ip_address, row.asset_tag,
     row.serial_number, row.os_type, row.location, row.hosted_ip,
     reason || null, userId || null, name],
  );
}

// Close the newest open log row for this asset (reactivation).
async function logReactivation(source, assetId, userId) {
  const name = await userName(userId);
  await db.query(
    `UPDATE decommission_log
        SET reactivated_at = NOW(), reactivated_by = $3, reactivated_by_name = $4
      WHERE id = (
        SELECT id FROM decommission_log
         WHERE source = $1 AND asset_id = $2 AND reactivated_at IS NULL
         ORDER BY decommissioned_at DESC LIMIT 1
      )`,
    [source, assetId, userId || null, name],
  );
}

module.exports = { isDecomStatus, logDecommission, logReactivation };
