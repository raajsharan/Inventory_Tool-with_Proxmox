const db = require('../config/db');
const ApiError = require('../utils/ApiError');
const { decrypt } = require('../utils/crypto');
const { renameHostnameViaAnsible } = require('../utils/ansibleHostnameRename');
const { ansibleOsFamily } = require('../utils/hostnamePattern');
const audit = require('../services/auditService');

const SOURCE_TABLE = {
  assets: 'assets',
  beijing_assets: 'beijing_assets',
  ext_assets: 'ext_assets',
  physical_esxi_servers: 'physical_esxi_servers',
};

// Renames the live server's OS-level hostname via Ansible to match whatever
// is ALREADY saved in this record's os_hostname field — the request carries
// only {source, id}, never a hostname string, so the live change can never
// diverge from what the admin already committed to inventory via the normal
// Save (the "Assign this hostname" checkbox on the asset forms sets
// os_hostname as part of that same save, before this endpoint is ever
// called).
async function rename(req, res, next) {
  try {
    const { source, id } = req.body;
    const table = SOURCE_TABLE[source];
    if (!table) throw new ApiError(400, 'Unknown source: ' + source);

    const { rows } = await db.query(
      `SELECT ip_address, os_type, os_hostname, asset_username, asset_password_encrypted
         FROM ${table} WHERE id = $1 AND deleted_at IS NULL`,
      [id]
    );
    if (!rows.length) throw new ApiError(404, 'Record not found');
    const row = rows[0];

    if (!row.os_hostname) throw new ApiError(400, 'No hostname is saved on this record yet');
    if (!row.ip_address) throw new ApiError(400, 'This record has no IP address on file');

    const family = ansibleOsFamily(row.os_type);
    if (!family) {
      throw new ApiError(400,
        `Live hostname rename isn't supported for OS type "${row.os_type}" yet — only Linux and Windows.`);
    }

    let password = null;
    if (row.asset_password_encrypted) {
      try { password = decrypt(row.asset_password_encrypted); } catch { /* treated as missing below */ }
    }
    if (!row.asset_username || !password) {
      throw new ApiError(400, 'This record has no saved username/password to connect with');
    }

    const result = await renameHostnameViaAnsible({
      ip_address: row.ip_address,
      username: row.asset_username,
      password,
      isWindows: family === 'windows',
      newHostname: row.os_hostname,
    });

    await audit.log({
      user: req.user, action: 'RENAME_HOSTNAME', entityType: table, entityId: id,
      ipAddress: req.ip,
      details: { hostname: row.os_hostname, succeeded: result.succeeded },
    });

    res.json(result);
  } catch (e) { next(e); }
}

module.exports = { rename };
