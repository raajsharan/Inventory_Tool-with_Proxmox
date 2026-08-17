const db = require('../config/db');
const { DEFAULT_CONFIG: COMPLIANCE_DEFAULTS } = require('./complianceConfigController');
const vmwareDb  = require('../services/vmwareDbService');
const proxmoxDb = require('../services/proxmoxDbService');
const hypervDb  = require('../services/hypervDbService');

// Fields allowed in name-conflict cross-table JOINs (whitelist, never interpolate user input).
const VALID_CONFLICT_FIELDS = new Set(['vm_name', 'os_hostname', 'asset_name', 'ip_address', 'mac_address']);

// VM-like inventories rolled up: assets + beijing_assets + physical_esxi_servers.
// ext_assets is reported separately.
async function summary(_req, res, next) {
  try {
    // Fetch compliance config first so dynamic queries can be built before the parallel fan-out.
    let compCfg;
    try {
      const { rows } = await db.query('SELECT config FROM compliance_config WHERE id = 1');
      compCfg = (rows[0]?.config && Object.keys(rows[0].config).length) ? rows[0].config : COMPLIANCE_DEFAULTS;
    } catch (_) {
      compCfg = COMPLIANCE_DEFAULTS;
    }
    const mslInclStatuses = compCfg.msl?.include_server_statuses || COMPLIANCE_DEFAULTS.msl.include_server_statuses;
    const mslExclEol      = compCfg.msl?.exclude_eol_statuses    || COMPLIANCE_DEFAULTS.msl.exclude_eol_statuses;
    const conflictFlds    = (compCfg.ext?.name_conflict_fields    || COMPLIANCE_DEFAULTS.ext.name_conflict_fields)
                              .filter(f => VALID_CONFLICT_FIELDS.has(f));

    const invQ = db.query(`
      WITH inv AS (
        SELECT 'assets'::text AS source, asset_type, server_status, patching_type, eol_status,
               manage_engine_installed, tenable_installed
          FROM assets WHERE deleted_at IS NULL AND decommissioned_at IS NULL
        UNION ALL
        SELECT 'beijing_assets', asset_type, server_status, patching_type, eol_status,
               manage_engine_installed, tenable_installed
          FROM beijing_assets WHERE deleted_at IS NULL AND decommissioned_at IS NULL
        UNION ALL
        SELECT 'physical_esxi_servers', asset_type, server_status, NULL::text AS patching_type, NULL::text AS eol_status,
               NULL::boolean AS manage_engine_installed, NULL::boolean AS tenable_installed
          FROM physical_esxi_servers WHERE deleted_at IS NULL AND decommissioned_at IS NULL
      )
      SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE source IN ('assets','beijing_assets'))::int                              AS vms,
        COUNT(*) FILTER (WHERE source = 'physical_esxi_servers')::int                                   AS physical,
        COUNT(*) FILTER (WHERE manage_engine_installed = TRUE)::int                                     AS me_installed,
        COUNT(*) FILTER (WHERE tenable_installed = TRUE)::int                                           AS tenable_installed,
        COUNT(*) FILTER (WHERE patching_type ILIKE 'Automatic%' OR patching_type ILIKE 'Auto%')::int    AS auto_patching,
        COUNT(*) FILTER (WHERE patching_type ILIKE 'Manual%')::int                                      AS manual_patching,
        COUNT(*) FILTER (WHERE patching_type ILIKE 'Exception%')::int                                   AS exception_patching,
        COUNT(*) FILTER (WHERE source = 'beijing_assets')::int                                          AS beijing,
        COUNT(*) FILTER (WHERE eol_status = 'EOL')::int                                                 AS eol_no_patches,
        COUNT(*) FILTER (WHERE server_status ILIKE 'Onboard%')::int                                     AS onboard_pending,
        COUNT(*) FILTER (WHERE server_status ILIKE 'On Hold%')::int                                     AS on_hold,
        COUNT(*) FILTER (WHERE server_status = 'Active' OR server_status ILIKE 'Alive%')::int           AS alive,
        COUNT(*) FILTER (WHERE server_status ILIKE 'Powered Off%' OR server_status ILIKE 'Power Off%')::int AS powered_off,
        COUNT(*) FILTER (WHERE server_status IN ('Decommissioned','Not Alive','Inactive') OR server_status ILIKE 'Dead%')::int AS not_alive
      FROM inv;
    `);

    const extQ = db.query(`
      SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE server_status = 'Active' OR server_status ILIKE 'Alive%')::int AS active,
        COUNT(*) FILTER (
          WHERE server_status IS NOT NULL
            AND server_status <> 'Active'
            AND server_status NOT ILIKE 'Alive%'
        )::int                                                                              AS inactive,
        COUNT(*) FILTER (WHERE manage_engine_installed = TRUE)::int                          AS me_installed,
        COUNT(*) FILTER (WHERE tenable_installed     = TRUE)::int                            AS tenable_installed
      FROM ext_assets
      WHERE deleted_at IS NULL AND decommissioned_at IS NULL;
    `);

    // Chart data (kept for Asset Inventory tab).
    const osQ = db.query(`
      SELECT COALESCE(os_type,'Unspecified') AS key, COUNT(*)::int AS value
        FROM (
          SELECT os_type FROM assets WHERE deleted_at IS NULL AND decommissioned_at IS NULL
          UNION ALL SELECT os_type FROM beijing_assets WHERE deleted_at IS NULL AND decommissioned_at IS NULL
          UNION ALL SELECT os_type FROM physical_esxi_servers WHERE deleted_at IS NULL AND decommissioned_at IS NULL
        ) x GROUP BY 1 ORDER BY 2 DESC`);
    const statusQ = db.query(`
      SELECT COALESCE(server_status,'Unspecified') AS key, COUNT(*)::int AS value
        FROM (
          SELECT server_status FROM assets WHERE deleted_at IS NULL AND decommissioned_at IS NULL
          UNION ALL SELECT server_status FROM beijing_assets WHERE deleted_at IS NULL AND decommissioned_at IS NULL
          UNION ALL SELECT server_status FROM physical_esxi_servers WHERE deleted_at IS NULL AND decommissioned_at IS NULL
        ) x GROUP BY 1 ORDER BY 2 DESC`);
    const locQ = db.query(`
      SELECT COALESCE(location,'Unspecified') AS key, COUNT(*)::int AS value
        FROM (
          SELECT location FROM assets WHERE deleted_at IS NULL AND decommissioned_at IS NULL
          UNION ALL SELECT location FROM beijing_assets WHERE deleted_at IS NULL AND decommissioned_at IS NULL
          UNION ALL SELECT location FROM physical_esxi_servers WHERE deleted_at IS NULL AND decommissioned_at IS NULL
        ) x GROUP BY 1 ORDER BY 2 DESC`);
    const eolQ = db.query(`
      SELECT COALESCE(eol_status,'Unspecified') AS key, COUNT(*)::int AS value
        FROM (
          SELECT eol_status FROM assets WHERE deleted_at IS NULL AND decommissioned_at IS NULL
          UNION ALL SELECT eol_status FROM beijing_assets WHERE deleted_at IS NULL AND decommissioned_at IS NULL
          UNION ALL SELECT NULL::text AS eol_status FROM physical_esxi_servers WHERE deleted_at IS NULL AND decommissioned_at IS NULL
        ) x GROUP BY 1 ORDER BY 2 DESC`);
    const recentQ = db.query(`
      SELECT id, vm_name, ip_address, os_type, server_status, location, created_at, source_table
        FROM (
          SELECT id, vm_name, ip_address, os_type, server_status, location, created_at, 'assets'::text AS source_table
            FROM assets WHERE deleted_at IS NULL AND decommissioned_at IS NULL
          UNION ALL
          SELECT id, vm_name, ip_address, os_type, server_status, location, created_at, 'beijing_assets'::text AS source_table
            FROM beijing_assets WHERE deleted_at IS NULL AND decommissioned_at IS NULL
          UNION ALL
          SELECT id, vm_name, ip_address, os_type, server_status, location, created_at, 'physical_esxi_servers'::text AS source_table
            FROM physical_esxi_servers WHERE deleted_at IS NULL AND decommissioned_at IS NULL
        ) x
        ORDER BY created_at DESC LIMIT 10`);

    // Weekly Report counters (created in the last 7 days vs prior 7 days).
    const weeklyQ = db.query(`
      WITH inv AS (
        SELECT created_at, server_status, patching_type FROM assets WHERE deleted_at IS NULL AND decommissioned_at IS NULL
        UNION ALL SELECT created_at, server_status, patching_type FROM beijing_assets WHERE deleted_at IS NULL AND decommissioned_at IS NULL
        UNION ALL SELECT created_at, server_status, NULL::text AS patching_type FROM physical_esxi_servers WHERE deleted_at IS NULL AND decommissioned_at IS NULL
      )
      SELECT
        COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '7 days')::int                              AS added_this_week,
        COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '14 days' AND created_at < NOW() - INTERVAL '7 days')::int AS added_last_week,
        COUNT(*) FILTER (WHERE patching_type ILIKE 'Automatic%' OR patching_type ILIKE 'Auto%')::int      AS compliant_now,
        COUNT(*)::int AS total_now
      FROM inv;
    `);

    // ---------------------------------------------------------------
    // MSL Compliance: filtered by admin-configured server statuses /
    // EOL exclusion list (stored in compliance_config).
    // $1 = include_server_statuses[], $2 = exclude_eol_statuses[]
    // Empty arrays mean "no filter" (all pass).
    // ---------------------------------------------------------------
    // Denominator = eligible universe (in-scope by server_status / EOL filters, per admin config).
    // Numerator = the compliant subset of that universe — mirrors the same
    // "password on file" convention used for extComplianceQ.with_password below,
    // so MSL is no longer numerator === denominator (always 100%).
    const mslQ = db.query(`
      WITH inv AS (
        SELECT server_status, eol_status, asset_password_encrypted FROM assets WHERE deleted_at IS NULL AND decommissioned_at IS NULL
        UNION ALL SELECT server_status, eol_status, asset_password_encrypted FROM beijing_assets WHERE deleted_at IS NULL AND decommissioned_at IS NULL
        UNION ALL SELECT server_status, NULL::text AS eol_status, asset_password_encrypted FROM physical_esxi_servers WHERE deleted_at IS NULL AND decommissioned_at IS NULL
      )
      SELECT
        COUNT(*)::int                                                    AS msl_denominator,
        COUNT(*) FILTER (WHERE asset_password_encrypted IS NOT NULL)::int AS msl_numerator
        FROM inv
       WHERE (
         array_length($1::text[], 1) IS NULL
         OR LOWER(COALESCE(server_status,'')) = ANY(SELECT LOWER(x) FROM unnest($1::text[]) AS x)
       )
       AND (
         array_length($2::text[], 1) IS NULL
         OR NOT (LOWER(COALESCE(eol_status,'')) = ANY(SELECT LOWER(x) FROM unnest($2::text[]) AS x))
       )
    `, [mslInclStatuses, mslExclEol]);

    // Beijing Assets' raw VM count (asset_type = 'vm', not MSL-status-filtered
    // like mslQ's own small Beijing subset above) — added on top of
    // combinedNumerator/combinedDenominator only, so the "Overall Asset
    // Inventory" figure reflects the full Beijing inventory. Deliberately
    // NOT removed from mslQ's union, so the standalone MSL Compliance
    // figures elsewhere (Executive Overview, Weekly Report masthead) are
    // unaffected — this does mean Beijing's small MSL-eligible subset is
    // counted twice across the two paths, which is an accepted trade-off.
    const beijingRawQ = db.query(`
      SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE asset_password_encrypted IS NOT NULL)::int AS with_password
        FROM beijing_assets
       WHERE deleted_at IS NULL AND decommissioned_at IS NULL
         AND LOWER(TRIM(COALESCE(asset_type, ''))) = 'vm'
    `);

    // "in_scope" = countable endpoint: not deleted, not decommissioned
    // (flag or status), and status is not Not Applicable / Not in Scope.
    const extComplianceQ = db.query(`
      WITH e AS (
        SELECT *,
               (decommissioned_at IS NULL
                AND (server_status IS NULL OR (
                      server_status NOT ILIKE 'Decom%'
                  AND server_status NOT ILIKE 'Not Applic%'
                  AND REPLACE(REPLACE(server_status, '-', ' '), '_', ' ') NOT ILIKE 'Not in Scope%'
                  AND REPLACE(REPLACE(server_status, '-', ' '), '_', ' ') NOT ILIKE 'Out of Scope%'
                ))) AS in_scope
          FROM ext_assets
         WHERE deleted_at IS NULL
      )
      SELECT
        COUNT(*) FILTER (WHERE in_scope)::int                          AS total,
        COUNT(*) FILTER (
          WHERE decommissioned_at IS NOT NULL OR server_status ILIKE 'Decom%'
        )::int                                                         AS decommissioned,
        COUNT(*) FILTER (
          WHERE asset_password_encrypted IS NOT NULL AND in_scope
        )::int                                                         AS with_password,
        COUNT(*) FILTER (
          WHERE manage_engine_installed = TRUE AND in_scope
        )::int                                                         AS me_installed,
        COUNT(*) FILTER (
          WHERE asset_type ILIKE '%network%' OR asset_type ILIKE '%switch%'
             OR asset_type ILIKE '%printer%' OR asset_type ILIKE '%ups%'
             OR asset_type ILIKE '%router%'  OR asset_type ILIKE '%firewall%'
        )::int                                                         AS me_not_applicable,
        COUNT(*) FILTER (
          WHERE patching_type ILIKE 'Auto%' AND in_scope
        )::int                                                         AS auto_patching,
        COUNT(*) FILTER (
          WHERE patching_type ILIKE 'Manual%' AND in_scope
        )::int                                                         AS manual_patching
      FROM e;
    `);

    // Name conflicts: dynamic — fields determined by compliance_config.ext.name_conflict_fields.
    // Field names are whitelisted before interpolation; safe against injection.
    const _conflictFlds = conflictFlds.length ? conflictFlds : ['vm_name', 'os_hostname'];
    const _conflictTbls = ['assets', 'beijing_assets', 'physical_esxi_servers'];
    const _existsClauses = _conflictTbls.flatMap(t =>
      _conflictFlds.map(f => `EXISTS (SELECT 1 FROM ${t} x WHERE x.${f} = e.${f} AND x.deleted_at IS NULL)`)
    ).join('\n          OR ');
    const nameConflictQ = db.query(
      `SELECT COUNT(*)::int AS c FROM ext_assets e WHERE e.deleted_at IS NULL AND (${_existsClauses})`
    );

    // Location-wise count across all four inventories (MSL + ext combined).
    const locationCountQ = db.query(`
      SELECT COALESCE(location, 'Unspecified') AS location, COUNT(*)::int AS count
        FROM (
          SELECT location FROM assets WHERE deleted_at IS NULL AND decommissioned_at IS NULL
          UNION ALL SELECT location FROM beijing_assets WHERE deleted_at IS NULL AND decommissioned_at IS NULL
          UNION ALL SELECT location FROM physical_esxi_servers WHERE deleted_at IS NULL AND decommissioned_at IS NULL
          UNION ALL SELECT location FROM ext_assets WHERE deleted_at IS NULL AND decommissioned_at IS NULL
        ) x
        WHERE location IS NOT NULL AND location <> ''
        GROUP BY 1
        ORDER BY 2 DESC
        LIMIT 10;
    `);

    // Location-wise count for ext_assets only (shown in Weekly → Extended Inventory).
    const extLocationCountQ = db.query(`
      SELECT COALESCE(location, 'Unassigned') AS location, COUNT(*)::int AS count
        FROM ext_assets
        WHERE deleted_at IS NULL
          AND LOWER(COALESCE(server_status,'')) NOT IN ('decommissioned','not applicable','not in scope')
        GROUP BY 1
        ORDER BY 2 DESC;
    `);

    // Location-wise count for Asset Inventory + Ext. Assets combined
    // (shown in the Weekly Report's merged Asset Inventory section). Mirrors
    // the same row population as mslQ (assets+beijing+physical_esxi, filtered
    // by the configurable status/EOL lists) and extComplianceQ's in_scope
    // definition, so this total lines up with mslDenominator + extComp.total.
    // Beijing Assets is grouped by its own location field, same as the
    // rest — counted as raw VM-only rows (asset_type = 'vm'), not
    // MSL-scope filtered, matching the Beijing Assets page's own total
    // minus non-VM rows.
    const assetExtLocationCountQ = db.query(`
      WITH inv AS (
        SELECT location, server_status, eol_status FROM assets WHERE deleted_at IS NULL AND decommissioned_at IS NULL
        UNION ALL SELECT location, server_status, NULL::text AS eol_status FROM physical_esxi_servers WHERE deleted_at IS NULL AND decommissioned_at IS NULL
      ),
      inv_f AS (
        SELECT location FROM inv
         WHERE (
           array_length($1::text[], 1) IS NULL
           OR LOWER(COALESCE(server_status,'')) = ANY(SELECT LOWER(x) FROM unnest($1::text[]) AS x)
         )
         AND (
           array_length($2::text[], 1) IS NULL
           OR NOT (LOWER(COALESCE(eol_status,'')) = ANY(SELECT LOWER(x) FROM unnest($2::text[]) AS x))
         )
      ),
      ext_f AS (
        SELECT location
          FROM ext_assets
         WHERE deleted_at IS NULL
           AND decommissioned_at IS NULL
           AND (server_status IS NULL OR (
                 server_status NOT ILIKE 'Decom%'
             AND server_status NOT ILIKE 'Not Applic%'
             AND REPLACE(REPLACE(server_status, '-', ' '), '_', ' ') NOT ILIKE 'Not in Scope%'
             AND REPLACE(REPLACE(server_status, '-', ' '), '_', ' ') NOT ILIKE 'Out of Scope%'
           ))
      ),
      beijing_f AS (
        SELECT location FROM beijing_assets
         WHERE deleted_at IS NULL AND decommissioned_at IS NULL
           AND LOWER(TRIM(COALESCE(asset_type, ''))) = 'vm'
      )
      SELECT COALESCE(location, 'Unassigned') AS location, COUNT(*)::int AS count
        FROM (SELECT location FROM inv_f UNION ALL SELECT location FROM ext_f UNION ALL SELECT location FROM beijing_f) x
       WHERE location IS NOT NULL AND location <> ''
       GROUP BY 1
       ORDER BY 2 DESC;
    `, [mslInclStatuses, mslExclEol]);

    // ---------------------------------------------------------------
    // Asset Inventory Active Status (Windows/Linux only, excluding VMware).
    // ---------------------------------------------------------------
    const activeStatusQ = db.query(`
      WITH inv AS (
        SELECT os_type, server_status FROM assets WHERE deleted_at IS NULL AND decommissioned_at IS NULL
        UNION ALL SELECT os_type, server_status FROM beijing_assets WHERE deleted_at IS NULL AND decommissioned_at IS NULL
        UNION ALL SELECT os_type, server_status FROM physical_esxi_servers WHERE deleted_at IS NULL AND decommissioned_at IS NULL
      ), filtered AS (
        SELECT * FROM inv
         WHERE (os_type ILIKE '%windows%' OR os_type ILIKE '%linux%')
           AND COALESCE(os_type,'') NOT ILIKE '%vmware%'
      )
      SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE server_status = 'Active' OR server_status ILIKE 'Alive%')::int       AS active,
        COUNT(*) FILTER (WHERE server_status ILIKE 'Powered Off%' OR server_status ILIKE 'Power Off%'
                            OR server_status IN ('Decommissioned','Not Alive','Inactive','Dead'))::int AS non_active,
        COUNT(*) FILTER (WHERE server_status ILIKE 'Onboard%' OR server_status ILIKE 'Pending%')::int  AS pending,
        COUNT(*) FILTER (WHERE server_status ILIKE 'On Hold%')::int                                     AS on_hold,
        COUNT(*) FILTER (
          WHERE server_status IS NULL
             OR (server_status NOT IN ('Active')
                 AND server_status NOT ILIKE 'Alive%'
                 AND server_status NOT ILIKE 'Powered Off%'
                 AND server_status NOT ILIKE 'Power Off%'
                 AND server_status NOT IN ('Decommissioned','Not Alive','Inactive','Dead')
                 AND server_status NOT ILIKE 'Onboard%'
                 AND server_status NOT ILIKE 'Pending%'
                 AND server_status NOT ILIKE 'On Hold%'))::int                                          AS uncategorized
      FROM filtered;
    `);

    // ---------------------------------------------------------------
    // Asset Inventory Patching Status across VM/physical/bare-metal.
    // ---------------------------------------------------------------
    const patchingStatusQ = db.query(`
      WITH inv AS (
        SELECT 'assets'::text AS source, server_status, patching_type, eol_status FROM assets WHERE deleted_at IS NULL AND decommissioned_at IS NULL
        UNION ALL SELECT 'beijing_assets', server_status, patching_type, eol_status FROM beijing_assets WHERE deleted_at IS NULL AND decommissioned_at IS NULL
        UNION ALL SELECT 'physical_esxi_servers', server_status, NULL::text AS patching_type, NULL::text AS eol_status FROM physical_esxi_servers WHERE deleted_at IS NULL AND decommissioned_at IS NULL
      )
      SELECT
        COUNT(*)::int                                                                                AS total,
        COUNT(*) FILTER (WHERE patching_type ILIKE 'Auto%')::int                                     AS auto_patching,
        COUNT(*) FILTER (WHERE patching_type ILIKE 'Manual%')::int                                   AS manual_patching,
        COUNT(*) FILTER (WHERE patching_type ILIKE 'Exception%')::int                                AS exception,
        COUNT(*) FILTER (WHERE source = 'beijing_assets')::int                                       AS beijing_it,
        COUNT(*) FILTER (WHERE eol_status = 'EOL')::int                                              AS eol,
        COUNT(*) FILTER (WHERE server_status ILIKE 'Onboard%' OR server_status ILIKE 'Pending%')::int AS pending,
        COUNT(*) FILTER (WHERE server_status ILIKE 'On Hold%')::int                                  AS on_hold,
        COUNT(*) FILTER (WHERE server_status ILIKE 'Powered Off%' OR server_status ILIKE 'Power Off%')::int AS alive_powered_off,
        COUNT(*) FILTER (
          WHERE eol_status IS NULL
             OR (eol_status NOT ILIKE 'Not Applicable%' AND eol_status NOT IN ('NA','N/A'))
        )::int                                                                                       AS total_excl_na
      FROM inv;
    `);

    // VM-only location distribution (assets + beijing_assets).
    const vmLocationQ = db.query(`
      SELECT COALESCE(location, 'Unspecified') AS location, COUNT(*)::int AS count
        FROM (
          SELECT location FROM assets WHERE deleted_at IS NULL AND decommissioned_at IS NULL
          UNION ALL SELECT location FROM beijing_assets WHERE deleted_at IS NULL AND decommissioned_at IS NULL
        ) x
        WHERE location IS NOT NULL AND location <> ''
        GROUP BY 1
        ORDER BY 2 DESC
        LIMIT 10;
    `);

    // ---------------------------------------------------------------
    // Weekly Report: VM-side "gaps" (no password / missing hosted_ip /
    // OS-hostname collisions) and the Ext patching-status row.
    // ---------------------------------------------------------------
    const weeklyVmGapsQ = db.query(`
      WITH vm AS (
        SELECT asset_password_encrypted, hosted_ip, os_hostname,
               server_status, eol_status
          FROM assets               WHERE deleted_at IS NULL
        UNION ALL
        SELECT asset_password_encrypted, hosted_ip, os_hostname,
               server_status, eol_status
          FROM beijing_assets       WHERE deleted_at IS NULL
        UNION ALL
        SELECT asset_password_encrypted, hosted_ip, os_hostname,
               server_status, NULL::text AS eol_status
          FROM physical_esxi_servers WHERE deleted_at IS NULL
      ), dup_hostnames AS (
        SELECT os_hostname FROM vm
         WHERE os_hostname IS NOT NULL AND os_hostname <> ''
        GROUP BY 1 HAVING COUNT(*) > 1
      )
      SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (
          WHERE server_status = 'Decommissioned' OR server_status ILIKE 'Decom%'
        )::int AS decommissioned,
        COUNT(*) FILTER (
          WHERE (server_status = 'Active' OR server_status ILIKE 'Alive%')
            AND asset_password_encrypted IS NULL
        )::int AS no_password,
        COUNT(*) FILTER (
          WHERE (server_status = 'Active' OR server_status ILIKE 'Alive%')
            AND (hosted_ip IS NULL OR hosted_ip = '')
        )::int AS no_hosted_ip,
        (SELECT COUNT(*)::int FROM vm
           WHERE os_hostname IN (SELECT os_hostname FROM dup_hostnames)
        ) AS name_conflicts
      FROM vm;
    `);

    // Weekly Report: raw Nessus install count across the whole inventory —
    // deliberately NOT excluding appliances/hypervisors/EOL-unsupported OS
    // like the Nessus Agent Status page's own compliance % does, since this
    // line is meant to show against the full inventory with that fact
    // called out as a footnote, not the agent-eligible subset.
    const weeklyNessusQ = db.query(`
      WITH all_vms AS (
        SELECT tenable_installed FROM assets              WHERE deleted_at IS NULL AND decommissioned_at IS NULL
        UNION ALL
        SELECT tenable_installed FROM beijing_assets       WHERE deleted_at IS NULL AND decommissioned_at IS NULL
        UNION ALL
        SELECT tenable_installed FROM ext_assets           WHERE deleted_at IS NULL AND decommissioned_at IS NULL
        UNION ALL
        SELECT false AS tenable_installed FROM physical_esxi_servers WHERE deleted_at IS NULL AND decommissioned_at IS NULL
      )
      SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE tenable_installed)::int AS installed
      FROM all_vms
    `);

    // ---------------------------------------------------------------
    // Weekly Report extras: location-wise + department-wise patching
    // breakdown across the three VM-side tables. Beijing IT column =
    // rows that came from the beijing_assets table for that bucket.
    // ---------------------------------------------------------------
    const buildWeeklyBreakdown = (groupCol) => `
      WITH inv AS (
        SELECT 'assets'::text AS source, location, department, server_status, patching_type, eol_status
          FROM assets WHERE deleted_at IS NULL
        UNION ALL
        SELECT 'beijing_assets', location, department, server_status, patching_type, eol_status
          FROM beijing_assets WHERE deleted_at IS NULL
        UNION ALL
        SELECT 'physical_esxi_servers', location, department, server_status, NULL::text AS patching_type, NULL::text AS eol_status
          FROM physical_esxi_servers WHERE deleted_at IS NULL
      )
      SELECT
        COALESCE(NULLIF(TRIM(${groupCol}), ''), 'Unassigned')                                        AS bucket,
        COUNT(*) FILTER (WHERE server_status ILIKE 'Powered Off%' OR server_status ILIKE 'Power Off%')::int AS alive_powered_off,
        COUNT(*) FILTER (WHERE patching_type ILIKE 'Auto%')::int                                     AS auto_patching,
        COUNT(*) FILTER (WHERE source = 'beijing_assets')::int                                       AS beijing_it,
        COUNT(*) FILTER (WHERE eol_status = 'EOL')::int                                              AS eol,
        COUNT(*) FILTER (WHERE patching_type ILIKE 'Exception%')::int                                AS exception,
        COUNT(*) FILTER (WHERE patching_type ILIKE 'Manual%')::int                                   AS manual_patching,
        COUNT(*) FILTER (WHERE server_status ILIKE 'On Hold%')::int                                  AS on_hold,
        COUNT(*) FILTER (WHERE server_status ILIKE 'Onboard%' OR server_status ILIKE 'Pending%')::int AS onboard_pending,
        COUNT(*)::int                                                                                AS total
      FROM inv
      WHERE COALESCE(NULLIF(TRIM(${groupCol}), ''), '') <> ''
      GROUP BY 1
      ORDER BY total DESC, 1
    `;
    const weeklyLocationPatchingQ   = db.query(buildWeeklyBreakdown('location'));
    const weeklyDepartmentPatchingQ = db.query(buildWeeklyBreakdown('department'));

    // ---------------------------------------------------------------
    // ME Compliance breakdown: patching-type bucket × ME installed
    // MSL side (assets + beijing + physical)
    // ---------------------------------------------------------------
    const meMslBreakdownQ = db.query(`
      WITH inv AS (
        SELECT 'assets'::text AS src, server_status, patching_type, eol_status,
               COALESCE(manage_engine_installed, false) AS me
          FROM assets WHERE deleted_at IS NULL
        UNION ALL
        SELECT 'beijing_assets', server_status, patching_type, eol_status,
               COALESCE(manage_engine_installed, false)
          FROM beijing_assets WHERE deleted_at IS NULL
        UNION ALL
        SELECT 'physical_esxi_servers', server_status, NULL::text AS patching_type, NULL::text AS eol_status,
               false
          FROM physical_esxi_servers WHERE deleted_at IS NULL
      ),
      cat AS (
        SELECT
          CASE
            WHEN src = 'beijing_assets'                                                              THEN 'Beijing IT Team'
            WHEN server_status ILIKE 'Powered Off%' OR server_status ILIKE 'Power Off%'             THEN 'Alive But Powered Off'
            WHEN eol_status = 'EOL'                                                                  THEN 'EOL - No Patches'
            WHEN eol_status ILIKE 'Not Applicable%' OR eol_status IN ('NA','N/A')                   THEN 'Not Applicable'
            WHEN server_status ILIKE 'On Hold%'                                                      THEN 'On Hold'
            WHEN server_status ILIKE 'Onboard%' OR server_status ILIKE 'Pending%'                   THEN 'Onboard Pending'
            WHEN patching_type ILIKE 'Auto%'                                                         THEN 'Auto'
            WHEN patching_type ILIKE 'Exception%'                                                    THEN 'Exception'
            WHEN patching_type ILIKE 'Manual%'                                                       THEN 'Manual'
            ELSE 'Other'
          END AS bucket,
          me
        FROM inv
      )
      SELECT
        bucket,
        COUNT(*) FILTER (WHERE me = false)::int AS no_me,
        COUNT(*) FILTER (WHERE me = true)::int  AS yes_me,
        COUNT(*)::int                            AS total,
        CASE bucket
          WHEN 'Alive But Powered Off' THEN 1
          WHEN 'Auto'                  THEN 2
          WHEN 'Beijing IT Team'       THEN 3
          WHEN 'EOL - No Patches'      THEN 4
          WHEN 'Exception'             THEN 5
          WHEN 'Manual'                THEN 6
          WHEN 'Not Applicable'        THEN 7
          WHEN 'On Hold'               THEN 8
          WHEN 'Onboard Pending'       THEN 9
          ELSE 10
        END AS sort_order
      FROM cat
      GROUP BY 1
      ORDER BY sort_order;
    `);

    // ---------------------------------------------------------------
    // ME Compliance breakdown: Extended Inventory (ext_assets)
    // ---------------------------------------------------------------
    const meExtBreakdownQ = db.query(`
      WITH cat AS (
        SELECT
          CASE
            WHEN server_status ILIKE 'Powered Off%' OR server_status ILIKE 'Power Off%'             THEN 'Alive But Powered Off'
            WHEN eol_status = 'EOL'                                                                  THEN 'EOL - No Patches'
            WHEN eol_status ILIKE 'Not Applicable%' OR eol_status IN ('NA','N/A')
              OR asset_type ILIKE '%network%' OR asset_type ILIKE '%switch%'
              OR asset_type ILIKE '%printer%' OR asset_type ILIKE '%ups%'
              OR asset_type ILIKE '%router%'  OR asset_type ILIKE '%firewall%'                       THEN 'Not Applicable'
            WHEN server_status ILIKE 'On Hold%'                                                      THEN 'On Hold'
            WHEN server_status ILIKE 'Onboard%' OR server_status ILIKE 'Pending%'                   THEN 'Onboard Pending'
            WHEN department ILIKE '%beijing%' OR business_purpose ILIKE '%beijing%'                  THEN 'Beijing IT Team'
            WHEN patching_type ILIKE 'Auto%'                                                         THEN 'Auto'
            WHEN patching_type ILIKE 'Exception%'                                                    THEN 'Exception'
            WHEN patching_type ILIKE 'Manual%'                                                       THEN 'Manual'
            ELSE 'Other'
          END AS bucket,
          COALESCE(manage_engine_installed, false) AS me
        FROM ext_assets
        WHERE deleted_at IS NULL AND decommissioned_at IS NULL
          AND (server_status IS NULL
           OR (server_status <> 'Decommissioned' AND server_status NOT ILIKE 'Decom%'))
      )
      SELECT
        bucket,
        COUNT(*) FILTER (WHERE me = false)::int AS no_me,
        COUNT(*) FILTER (WHERE me = true)::int  AS yes_me,
        COUNT(*)::int                            AS total,
        CASE bucket
          WHEN 'Alive But Powered Off' THEN 1
          WHEN 'Auto'                  THEN 2
          WHEN 'Beijing IT Team'       THEN 3
          WHEN 'EOL - No Patches'      THEN 4
          WHEN 'Exception'             THEN 5
          WHEN 'Manual'                THEN 6
          WHEN 'Not Applicable'        THEN 7
          WHEN 'On Hold'               THEN 8
          WHEN 'Onboard Pending'       THEN 9
          ELSE 10
        END AS sort_order
      FROM cat
      GROUP BY 1
      ORDER BY sort_order;
    `);

    const extPatchingStatusQ = db.query(`
      SELECT
        COUNT(*)::int                                                                           AS total,
        COUNT(*) FILTER (WHERE patching_type ILIKE 'Auto%')::int                                AS auto_patching,
        COUNT(*) FILTER (WHERE patching_type ILIKE 'Manual%')::int                              AS manual_patching,
        COUNT(*) FILTER (WHERE patching_type ILIKE 'Exception%')::int                           AS exception,
        COUNT(*) FILTER (WHERE department ILIKE '%beijing%' OR business_purpose ILIKE '%beijing%')::int AS beijing_it,
        COUNT(*) FILTER (WHERE eol_status = 'EOL')::int                                         AS eol,
        COUNT(*) FILTER (WHERE server_status ILIKE 'Onboard%' OR server_status ILIKE 'Pending%')::int AS pending,
        COUNT(*) FILTER (WHERE server_status ILIKE 'On Hold%')::int                             AS on_hold,
        COUNT(*) FILTER (WHERE server_status ILIKE 'Powered Off%' OR server_status ILIKE 'Power Off%')::int AS alive_powered_off,
        COUNT(*) FILTER (
          WHERE eol_status IS NULL
             OR (eol_status NOT ILIKE 'Not Applicable%' AND eol_status NOT IN ('NA','N/A'))
        )::int                                                                                  AS total_excl_na
      FROM ext_assets
      WHERE deleted_at IS NULL AND decommissioned_at IS NULL;
    `);

    // Department-wise breakdown of ext_assets — one row per department
    // with totals across server_status / patching_type / eol_status /
    // agent installations.
    const extDeptDistQ = db.query(`
      SELECT
        COALESCE(NULLIF(TRIM(department), ''), 'Unassigned')                                   AS department,
        COUNT(*)::int                                                                          AS total,
        COUNT(*) FILTER (WHERE server_status = 'Active' OR server_status ILIKE 'Alive%')::int  AS active,
        COUNT(*) FILTER (
          WHERE server_status IS NOT NULL
            AND server_status <> 'Active'
            AND server_status NOT ILIKE 'Alive%'
        )::int                                                                                  AS inactive,
        COUNT(*) FILTER (WHERE server_status = 'Decommissioned' OR server_status ILIKE 'Decom%')::int AS decommissioned,
        COUNT(*) FILTER (WHERE server_status ILIKE 'Maintenance%')::int                        AS maintenance,
        COUNT(*) FILTER (WHERE patching_type ILIKE 'Auto%')::int                               AS auto_patching,
        COUNT(*) FILTER (WHERE patching_type ILIKE 'Manual%')::int                             AS manual_patching,
        COUNT(*) FILTER (WHERE patching_type ILIKE 'Exception%')::int                          AS exception,
        COUNT(*) FILTER (WHERE department ILIKE '%beijing%' OR business_purpose ILIKE '%beijing%')::int AS beijing_it,
        COUNT(*) FILTER (WHERE eol_status = 'EOL')::int                                        AS eol,
        COUNT(*) FILTER (WHERE eol_status ILIKE 'Not Applicable%' OR eol_status IN ('NA','N/A'))::int AS not_applicable,
        COUNT(*) FILTER (WHERE server_status ILIKE 'Onboard%' OR server_status ILIKE 'Pending%')::int AS pending,
        COUNT(*) FILTER (WHERE server_status ILIKE 'On Hold%')::int                            AS on_hold,
        COUNT(*) FILTER (WHERE server_status = 'Active' OR server_status ILIKE 'Alive%')::int  AS alive,
        COUNT(*) FILTER (WHERE server_status ILIKE 'Powered Off%' OR server_status ILIKE 'Power Off%')::int AS powered_off,
        COUNT(*) FILTER (WHERE server_status IN ('Decommissioned','Not Alive','Inactive','Dead'))::int AS not_alive,
        COUNT(*) FILTER (WHERE manage_engine_installed = TRUE)::int                            AS me,
        COUNT(*) FILTER (WHERE tenable_installed = TRUE)::int                                  AS tenable
      FROM ext_assets
      WHERE deleted_at IS NULL AND decommissioned_at IS NULL
      GROUP BY 1
      ORDER BY 2 DESC;
    `);

    const [inv, ext, os, st, lo, eol, recent, weekly, mslRow, extComp, nameConflict, locationCount,
           activeStatus, patchingStatus, vmLocation, extDeptDist, weeklyVmGaps, extPatchingStatus,
           weeklyLocationPatching, weeklyDepartmentPatching,
           meMslBreakdown, meExtBreakdown, extLocationCount, assetExtLocationCount, beijingRaw, weeklyNessus] = await Promise.all([
      invQ, extQ, osQ, statusQ, locQ, eolQ, recentQ, weeklyQ,
      mslQ, extComplianceQ, nameConflictQ, locationCountQ,
      activeStatusQ, patchingStatusQ, vmLocationQ, extDeptDistQ,
      weeklyVmGapsQ, extPatchingStatusQ,
      weeklyLocationPatchingQ, weeklyDepartmentPatchingQ,
      meMslBreakdownQ, meExtBreakdownQ, extLocationCountQ, assetExtLocationCountQ, beijingRawQ, weeklyNessusQ,
    ]);

    const i = inv.rows[0];
    const total = i.total || 0;
    const compliant = (i.auto_patching || 0) + (i.manual_patching || 0);
    const compliancePct  = total ? (compliant / total) * 100 : 0;
    const pending = (i.onboard_pending || 0) + (i.on_hold || 0);
    const readinessPct   = total ? ((total - pending) / total) * 100 : 0;
    const healthScore    = Math.round(0.6 * compliancePct + 0.4 * readinessPct);

    res.json({
      headline: {
        totalInventory: total + (ext.rows[0].total || 0),
        patchingCompliancePct: Math.round(compliancePct * 10) / 10,
        operationalReadinessPct: Math.round(readinessPct * 100) / 100,
        infrastructureHealthScore: healthScore,
        pendingActions: pending,
      },
      assetInventory: {
        totalAssets:    i.total,
        virtualMachines: i.vms,
        physicalServers: i.physical,
        manageEngine:    i.me_installed,
        tenable:         i.tenable_installed,
        autoPatching:    i.auto_patching,
        manualPatching:  i.manual_patching,
        exception:       i.exception_patching,
        beijingItTeam:   i.beijing,
        eolNoPatches:    i.eol_no_patches,
        onboardPending:  i.onboard_pending,
        onHold:          i.on_hold,
        alive:           i.alive,
        poweredOff:      i.powered_off,
        notAlive:        i.not_alive,
      },
      extendedInventory: {
        total:          ext.rows[0].total,
        active:         ext.rows[0].active,
        inactive:       ext.rows[0].inactive,
        meInstalled:    ext.rows[0].me_installed,
        tenable:        ext.rows[0].tenable_installed,
      },
      charts: {
        byOsType: os.rows,
        byServerStatus: st.rows,
        byLocation: lo.rows,
        byEolStatus: eol.rows,
      },
      recentAssets: recent.rows,
      weekly: {
        addedThisWeek: weekly.rows[0].added_this_week,
        addedLastWeek: weekly.rows[0].added_last_week,
        compliantNow:  weekly.rows[0].compliant_now,
        totalNow:      weekly.rows[0].total_now,
        currentCompliancePct: compliancePct,
      },

      mslCompliance: {
        mslNumerator:   mslRow.rows[0].msl_numerator,
        mslDenominator: mslRow.rows[0].msl_denominator,
        extNumerator:   extComp.rows[0].with_password,
        extDenominator: extComp.rows[0].total,
        combinedNumerator:   mslRow.rows[0].msl_numerator + extComp.rows[0].with_password + beijingRaw.rows[0].with_password,
        combinedDenominator: mslRow.rows[0].msl_denominator + extComp.rows[0].total + beijingRaw.rows[0].total,
        locations: locationCount.rows,
        assetExtLocations: assetExtLocationCount.rows,
      },

      extEndpointCompliance: {
        total:           extComp.rows[0].total,
        decommissioned:  extComp.rows[0].decommissioned,
        withPassword:    extComp.rows[0].with_password,
        meInstalled:     extComp.rows[0].me_installed,
        meNotApplicable: extComp.rows[0].me_not_applicable,
        nameConflicts:   nameConflict.rows[0].c,
        autoPatching:    extComp.rows[0].auto_patching,
        manualPatching:  extComp.rows[0].manual_patching,
        locationCount:   extLocationCount.rows,
      },

      assetInventoryActiveStatus: activeStatus.rows[0],
      assetInventoryPatchingStatus: patchingStatus.rows[0],
      extInventoryPatchingStatus:   extPatchingStatus.rows[0],
      vmCountByLocation: vmLocation.rows,
      extDeptDistribution: extDeptDist.rows,
      weeklyVmGaps: weeklyVmGaps.rows[0],
      weeklyNessus: weeklyNessus.rows[0],
      weeklyLocationPatching:   weeklyLocationPatching.rows,
      weeklyDepartmentPatching: weeklyDepartmentPatching.rows,
      meMslBreakdown:  meMslBreakdown.rows,
      meExtBreakdown:  meExtBreakdown.rows,

      // Legacy keys kept for backwards compatibility with the old Dashboard.
      total: i.total,
      byOsType: os.rows,
      byServerStatus: st.rows,
      byLocation: lo.rows,
      byEolStatus: eol.rows,
      missingSecurityTools: (i.total || 0) - Math.max(i.me_installed || 0, i.tenable_installed || 0),
      recentAssets: recent.rows,
    });
  } catch (e) { next(e); }
}

// ── Dashboard customization config (org-wide, JSONB) ────────────────────────
async function getConfig(_req, res, next) {
  try {
    const { rows } = await db.query(`SELECT config, updated_at FROM dashboard_config WHERE id = 1`);
    res.json(rows[0] || { config: {} });
  } catch (e) { next(e); }
}

async function saveConfig(req, res, next) {
  try {
    const config = req.body?.config;
    if (!config || typeof config !== 'object' || Array.isArray(config)) {
      const ApiError = require('../utils/ApiError');
      throw new ApiError(400, 'config object is required');
    }
    const { rows } = await db.query(
      `INSERT INTO dashboard_config (id, config, updated_by, updated_at)
       VALUES (1, $1, $2, NOW())
       ON CONFLICT (id) DO UPDATE
         SET config = EXCLUDED.config, updated_by = EXCLUDED.updated_by, updated_at = NOW()
       RETURNING config, updated_at`,
      [JSON.stringify(config), req.user.id],
    );
    res.json(rows[0]);
  } catch (e) { next(e); }
}

// ── Custom widget data — safe, whitelisted aggregation over inventories ─────
const WIDGET_TABLES = {
  all:                   ['assets', 'beijing_assets', 'ext_assets', 'physical_esxi_servers'],
  assets:                ['assets'],
  beijing_assets:        ['beijing_assets'],
  ext_assets:            ['ext_assets'],
  physical_esxi_servers: ['physical_esxi_servers'],
};
const WIDGET_FIELDS = [
  'os_type', 'server_status', 'location', 'eol_status', 'department',
  'patching_type', 'asset_type', 'ome_status', 'assigned_user',
];

async function widgetData(req, res, next) {
  try {
    const ApiError = require('../utils/ApiError');
    const source      = String(req.query.source || 'all');
    const groupBy     = req.query.groupBy ? String(req.query.groupBy) : null;
    const filterField = req.query.filterField ? String(req.query.filterField) : null;
    const filterValue = req.query.filterValue != null ? String(req.query.filterValue) : null;

    const tables = WIDGET_TABLES[source];
    if (!tables) throw new ApiError(400, `Unknown source "${source}"`);
    if (groupBy && !WIDGET_FIELDS.includes(groupBy)) throw new ApiError(400, `Field "${groupBy}" is not available for widgets`);
    if (filterField && !WIDGET_FIELDS.includes(filterField)) throw new ApiError(400, `Field "${filterField}" is not available for widgets`);

    const params = [];
    let filterSql = '';
    if (filterField && filterValue !== null && filterValue !== '') {
      params.push(filterValue);
      filterSql = ` AND ${filterField} ILIKE $${params.length}`;
    }
    const PHYS_ESXI_NULL = new Set(['patching_type', 'eol_status']);
    const union = tables.map(t => {
      const cols = WIDGET_FIELDS.map(f =>
        (t === 'physical_esxi_servers' && PHYS_ESXI_NULL.has(f)) ? `NULL::text AS ${f}` : f
      ).join(', ');
      return `SELECT ${cols} FROM ${t}
        WHERE deleted_at IS NULL AND decommissioned_at IS NULL${filterSql}`;
    }).join(' UNION ALL ');

    if (groupBy) {
      const { rows } = await db.query(
        `SELECT COALESCE(NULLIF(TRIM(${groupBy}), ''), 'Unspecified') AS key, COUNT(*)::int AS value
           FROM (${union}) u GROUP BY 1 ORDER BY 2 DESC LIMIT 30`,
        params,
      );
      return res.json({ rows });
    }
    const { rows } = await db.query(`SELECT COUNT(*)::int AS value FROM (${union}) u`, params);
    res.json({ value: rows[0].value });
  } catch (e) { next(e); }
}

// ---------------------------------------------------------------------------
// New VMs — reuses each integration's own drift detection (latest run vs.
// the one before it, per host) so this reflects exactly what the most
// recent poll of each hypervisor turned up. Naturally refreshes itself as
// each scheduler runs again and the comparison baseline moves forward —
// the frontend just needs to re-fetch this periodically to stay current.
// ---------------------------------------------------------------------------

function normalizeAdded(platform, host, added) {
  return added.map(v => ({
    platform,
    host,
    vm_name:     v.name || null,
    hostname:    v.hostname || null,
    os_type:     v.os_type || null,
    os_version:  platform === 'Hyper-V' ? (v.os_name || null) : (v.os_version || null),
    ip_address:  (Array.isArray(v.ips) ? v.ips.filter(ip => ip && ip !== 'Not Available') : []).join(', ') || null,
    source_host: v.source_host || null,
    mac_address: (Array.isArray(v.macs) ? v.macs : Array.isArray(v.mac_addresses) ? v.mac_addresses : [])
      .filter(m => m && m !== 'Not Available').join(', ') || null,
    discovered_at: null, // set below from the run's current_at
  }));
}

async function getNewVMs(_req, res, next) {
  try {
    const [vmwareDrift, proxmoxDrift, hypervDrift] = await Promise.all([
      vmwareDb.getDrift(), proxmoxDb.getDrift(), hypervDb.getDrift(),
    ]);

    const flatten = (platform, drift) => drift.flatMap(d =>
      normalizeAdded(platform, d.host, d.added).map(v => ({ ...v, discovered_at: d.current_at }))
    );

    const items = [
      ...flatten('VMware', vmwareDrift),
      ...flatten('Proxmox', proxmoxDrift),
      ...flatten('Hyper-V', hypervDrift),
    ].sort((a, b) => new Date(b.discovered_at) - new Date(a.discovered_at));

    res.json({ items, total: items.length });
  } catch (e) { next(e); }
}

module.exports = { summary, getConfig, saveConfig, widgetData, getNewVMs };
