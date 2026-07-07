const router = require('express').Router();
const { authenticate, authorize } = require('../middleware/auth');
const db = require('../config/db');

const UNION_ACTIVE = `
  SELECT id, vm_name, os_hostname, ip_address::text AS ip_address, location,
         asset_username, asset_password_encrypted, hosted_ip, 'assets' AS source
    FROM assets WHERE deleted_at IS NULL
  UNION ALL
  SELECT id, vm_name, os_hostname, ip_address::text, location,
         asset_username, asset_password_encrypted, hosted_ip, 'beijing_assets'
    FROM beijing_assets WHERE deleted_at IS NULL
  UNION ALL
  SELECT id, vm_name, os_hostname, ip_address::text, location,
         asset_username, asset_password_encrypted, hosted_ip, 'ext_assets'
    FROM ext_assets WHERE deleted_at IS NULL
  UNION ALL
  SELECT id, vm_name, os_hostname, ip_address::text, location,
         asset_username, asset_password_encrypted, hosted_ip, 'physical_esxi_servers'
    FROM physical_esxi_servers WHERE deleted_at IS NULL
`;

// GET /api/data-health — lists the records behind the weekly report's gap
// numbers: cross-inventory duplicates and missing critical fields.
router.get('/', authenticate, authorize('admin', 'superadmin'), async (req, res, next) => {
  try {
    const [dupIps, dupNames, missing] = await Promise.all([
      db.query(`
        SELECT ip_address,
               JSON_AGG(JSON_BUILD_OBJECT('id', id, 'vm_name', vm_name, 'source', source)
                        ORDER BY source, vm_name) AS records
          FROM (${UNION_ACTIVE}) u
         WHERE NULLIF(TRIM(ip_address), '') IS NOT NULL
         GROUP BY ip_address HAVING COUNT(*) > 1
         ORDER BY COUNT(*) DESC, ip_address
         LIMIT 200`),
      db.query(`
        SELECT vm_name,
               JSON_AGG(JSON_BUILD_OBJECT('id', id, 'ip_address', ip_address, 'source', source)
                        ORDER BY source, ip_address) AS records
          FROM (${UNION_ACTIVE}) u
         WHERE NULLIF(TRIM(vm_name), '') IS NOT NULL AND vm_name <> 'No Info'
         GROUP BY vm_name HAVING COUNT(*) > 1
         ORDER BY COUNT(*) DESC, vm_name
         LIMIT 200`),
      db.query(`
        SELECT id, vm_name, ip_address, source,
               (asset_password_encrypted IS NULL)          AS no_password,
               (NULLIF(TRIM(asset_username), '') IS NULL)  AS no_username,
               (NULLIF(TRIM(location), '') IS NULL)        AS no_location,
               (NULLIF(TRIM(hosted_ip), '') IS NULL)       AS no_hosted_ip
          FROM (${UNION_ACTIVE}) u
         WHERE asset_password_encrypted IS NULL
            OR NULLIF(TRIM(asset_username), '') IS NULL
            OR NULLIF(TRIM(location), '') IS NULL
            OR NULLIF(TRIM(hosted_ip), '') IS NULL
         ORDER BY source, vm_name
         LIMIT 500`),
    ]);

    const gaps = missing.rows;
    res.json({
      duplicate_ips:   dupIps.rows,
      duplicate_names: dupNames.rows,
      gaps,
      summary: {
        duplicate_ips:   dupIps.rows.length,
        duplicate_names: dupNames.rows.length,
        no_password:  gaps.filter(g => g.no_password).length,
        no_username:  gaps.filter(g => g.no_username).length,
        no_location:  gaps.filter(g => g.no_location).length,
        no_hosted_ip: gaps.filter(g => g.no_hosted_ip).length,
      },
    });
  } catch (e) { next(e); }
});

module.exports = router;
