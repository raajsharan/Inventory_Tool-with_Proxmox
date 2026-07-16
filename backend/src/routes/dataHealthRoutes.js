const router = require('express').Router();
const { authenticate, authorize } = require('../middleware/auth');
const db = require('../config/db');

const UNION_ACTIVE = `
  SELECT id, vm_name, os_hostname, ip_address::text AS ip_address, location,
         asset_username, asset_password_encrypted, hosted_ip, 'assets' AS source
    FROM assets WHERE deleted_at IS NULL AND decommissioned_at IS NULL
  UNION ALL
  SELECT id, vm_name, os_hostname, ip_address::text, location,
         asset_username, asset_password_encrypted, hosted_ip, 'beijing_assets'
    FROM beijing_assets WHERE deleted_at IS NULL AND decommissioned_at IS NULL
  UNION ALL
  SELECT id, vm_name, os_hostname, ip_address::text, location,
         asset_username, asset_password_encrypted, hosted_ip, 'ext_assets'
    FROM ext_assets WHERE deleted_at IS NULL AND decommissioned_at IS NULL
  UNION ALL
  SELECT id, vm_name, os_hostname, ip_address::text, location,
         asset_username, asset_password_encrypted, hosted_ip, 'physical_esxi_servers'
    FROM physical_esxi_servers WHERE deleted_at IS NULL AND decommissioned_at IS NULL
`;

// GET /api/data-health — lists the records behind the weekly report's gap
// numbers: cross-inventory duplicates and missing critical fields.
router.get('/', authenticate, authorize('admin', 'superadmin'), async (req, res, next) => {
  try {
    const [dupIps, dupNames, missing, dupIpCount, dupNameCount, missingCounts] = await Promise.all([
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
      // True (unLIMITed) counts for the summary tiles — the queries above are
      // capped for the detail tables and must not be used to derive totals.
      db.query(`
        SELECT COUNT(*) AS count FROM (
          SELECT ip_address
            FROM (${UNION_ACTIVE}) u
           WHERE NULLIF(TRIM(ip_address), '') IS NOT NULL
           GROUP BY ip_address HAVING COUNT(*) > 1
        ) sub`),
      db.query(`
        SELECT COUNT(*) AS count FROM (
          SELECT vm_name
            FROM (${UNION_ACTIVE}) u
           WHERE NULLIF(TRIM(vm_name), '') IS NOT NULL AND vm_name <> 'No Info'
           GROUP BY vm_name HAVING COUNT(*) > 1
        ) sub`),
      db.query(`
        SELECT COUNT(*) FILTER (WHERE asset_password_encrypted IS NULL)         AS no_password,
               COUNT(*) FILTER (WHERE NULLIF(TRIM(asset_username), '') IS NULL) AS no_username,
               COUNT(*) FILTER (WHERE NULLIF(TRIM(location), '') IS NULL)       AS no_location,
               COUNT(*) FILTER (WHERE NULLIF(TRIM(hosted_ip), '') IS NULL)     AS no_hosted_ip
          FROM (${UNION_ACTIVE}) u`),
    ]);

    const gaps = missing.rows;
    const counts = missingCounts.rows[0];
    res.json({
      duplicate_ips:   dupIps.rows,
      duplicate_names: dupNames.rows,
      gaps,
      summary: {
        duplicate_ips:   Number(dupIpCount.rows[0].count),
        duplicate_names: Number(dupNameCount.rows[0].count),
        no_password:  Number(counts.no_password),
        no_username:  Number(counts.no_username),
        no_location:  Number(counts.no_location),
        no_hosted_ip: Number(counts.no_hosted_ip),
      },
    });
  } catch (e) { next(e); }
});

module.exports = router;
