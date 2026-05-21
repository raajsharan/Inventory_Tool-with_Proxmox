const db = require('../config/db');

// VM-like inventories rolled up: assets + beijing_assets + physical_esxi_servers.
// ext_assets is reported separately.
async function summary(_req, res, next) {
  try {
    const invQ = db.query(`
      WITH inv AS (
        SELECT 'assets'::text AS source, asset_type, server_status, patching_type, eol_status,
               manage_engine_installed, tenable_installed
          FROM assets
        UNION ALL
        SELECT 'beijing_assets', asset_type, server_status, patching_type, eol_status,
               manage_engine_installed, tenable_installed
          FROM beijing_assets
        UNION ALL
        SELECT 'physical_esxi_servers', asset_type, server_status, patching_type, eol_status,
               manage_engine_installed, tenable_installed
          FROM physical_esxi_servers
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
      FROM ext_assets;
    `);

    // Chart data (kept for Asset Inventory tab).
    const osQ = db.query(`
      SELECT COALESCE(os_type,'Unspecified') AS key, COUNT(*)::int AS value
        FROM (
          SELECT os_type FROM assets
          UNION ALL SELECT os_type FROM beijing_assets
          UNION ALL SELECT os_type FROM physical_esxi_servers
        ) x GROUP BY 1 ORDER BY 2 DESC`);
    const statusQ = db.query(`
      SELECT COALESCE(server_status,'Unspecified') AS key, COUNT(*)::int AS value
        FROM (
          SELECT server_status FROM assets
          UNION ALL SELECT server_status FROM beijing_assets
          UNION ALL SELECT server_status FROM physical_esxi_servers
        ) x GROUP BY 1 ORDER BY 2 DESC`);
    const locQ = db.query(`
      SELECT COALESCE(location,'Unspecified') AS key, COUNT(*)::int AS value
        FROM (
          SELECT location FROM assets
          UNION ALL SELECT location FROM beijing_assets
          UNION ALL SELECT location FROM physical_esxi_servers
        ) x GROUP BY 1 ORDER BY 2 DESC`);
    const eolQ = db.query(`
      SELECT COALESCE(eol_status,'Unspecified') AS key, COUNT(*)::int AS value
        FROM (
          SELECT eol_status FROM assets
          UNION ALL SELECT eol_status FROM beijing_assets
          UNION ALL SELECT eol_status FROM physical_esxi_servers
        ) x GROUP BY 1 ORDER BY 2 DESC`);
    const recentQ = db.query(`
      SELECT id, vm_name, ip_address, os_type, server_status, location, created_at
        FROM assets ORDER BY created_at DESC LIMIT 10`);

    // Weekly Report counters (created in the last 7 days vs prior 7 days).
    const weeklyQ = db.query(`
      WITH inv AS (
        SELECT created_at, server_status, patching_type FROM assets
        UNION ALL SELECT created_at, server_status, patching_type FROM beijing_assets
        UNION ALL SELECT created_at, server_status, patching_type FROM physical_esxi_servers
      )
      SELECT
        COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '7 days')::int                              AS added_this_week,
        COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '14 days' AND created_at < NOW() - INTERVAL '7 days')::int AS added_last_week,
        COUNT(*) FILTER (WHERE patching_type ILIKE 'Automatic%' OR patching_type ILIKE 'Auto%')::int      AS compliant_now,
        COUNT(*)::int AS total_now
      FROM inv;
    `);

    // ---------------------------------------------------------------
    // MSL Compliance: VMs/physical that are Alive or Powered Off and
    // NOT Decommissioned / Not Applicable.
    // ---------------------------------------------------------------
    const mslQ = db.query(`
      WITH inv AS (
        SELECT server_status, eol_status FROM assets
        UNION ALL SELECT server_status, eol_status FROM beijing_assets
        UNION ALL SELECT server_status, eol_status FROM physical_esxi_servers
      )
      SELECT COUNT(*)::int AS msl
        FROM inv
       WHERE (server_status = 'Active' OR server_status ILIKE 'Alive%'
              OR server_status ILIKE 'Powered Off%' OR server_status ILIKE 'Power Off%')
         AND (eol_status IS NULL
              OR (eol_status NOT IN ('Decommissioned','Not Applicable','Decom','NA','N/A')
                  AND eol_status NOT ILIKE 'Decom%'
                  AND eol_status NOT ILIKE 'Not Applic%'));
    `);

    const extComplianceQ = db.query(`
      SELECT
        COUNT(*)::int                                                  AS total,
        COUNT(*) FILTER (WHERE asset_password_encrypted IS NOT NULL)::int AS with_password,
        COUNT(*) FILTER (WHERE manage_engine_installed = TRUE)::int   AS me_installed,
        COUNT(*) FILTER (
          WHERE asset_type ILIKE '%network%' OR asset_type ILIKE '%switch%'
             OR asset_type ILIKE '%printer%' OR asset_type ILIKE '%ups%'
             OR asset_type ILIKE '%router%'  OR asset_type ILIKE '%firewall%'
        )::int                                                         AS me_not_applicable,
        COUNT(*) FILTER (WHERE patching_type ILIKE 'Auto%')::int       AS auto_patching,
        COUNT(*) FILTER (WHERE patching_type ILIKE 'Manual%')::int     AS manual_patching
      FROM ext_assets;
    `);

    // Name conflicts: ext_assets whose vm_name OR os_hostname collides
    // with a record in any other inventory.
    const nameConflictQ = db.query(`
      SELECT COUNT(*)::int AS c FROM ext_assets e
       WHERE EXISTS (SELECT 1 FROM assets a
                       WHERE a.vm_name = e.vm_name OR a.os_hostname = e.os_hostname)
          OR EXISTS (SELECT 1 FROM beijing_assets b
                       WHERE b.vm_name = e.vm_name OR b.os_hostname = e.os_hostname)
          OR EXISTS (SELECT 1 FROM physical_esxi_servers p
                       WHERE p.vm_name = e.vm_name OR p.os_hostname = e.os_hostname);
    `);

    // Location-wise count across all four inventories.
    const locationCountQ = db.query(`
      SELECT COALESCE(location, 'Unspecified') AS location, COUNT(*)::int AS count
        FROM (
          SELECT location FROM assets
          UNION ALL SELECT location FROM beijing_assets
          UNION ALL SELECT location FROM physical_esxi_servers
          UNION ALL SELECT location FROM ext_assets
        ) x
        WHERE location IS NOT NULL AND location <> ''
        GROUP BY 1
        ORDER BY 2 DESC
        LIMIT 10;
    `);

    // ---------------------------------------------------------------
    // Asset Inventory Active Status (Windows/Linux only, excluding VMware).
    // ---------------------------------------------------------------
    const activeStatusQ = db.query(`
      WITH inv AS (
        SELECT os_type, server_status FROM assets
        UNION ALL SELECT os_type, server_status FROM beijing_assets
        UNION ALL SELECT os_type, server_status FROM physical_esxi_servers
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
        SELECT 'assets'::text AS source, server_status, patching_type, eol_status FROM assets
        UNION ALL SELECT 'beijing_assets', server_status, patching_type, eol_status FROM beijing_assets
        UNION ALL SELECT 'physical_esxi_servers', server_status, patching_type, eol_status FROM physical_esxi_servers
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
          SELECT location FROM assets
          UNION ALL SELECT location FROM beijing_assets
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
               server_status, eol_status
          FROM physical_esxi_servers WHERE deleted_at IS NULL
      ), dup_hostnames AS (
        SELECT os_hostname FROM vm
         WHERE os_hostname IS NOT NULL AND os_hostname <> ''
        GROUP BY 1 HAVING COUNT(*) > 1
      )
      SELECT
        COUNT(*)::int AS total,
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
        SELECT 'physical_esxi_servers', location, department, server_status, patching_type, eol_status
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
      FROM ext_assets;
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
      GROUP BY 1
      ORDER BY 2 DESC;
    `);

    const [inv, ext, os, st, lo, eol, recent, weekly, mslRow, extComp, nameConflict, locationCount,
           activeStatus, patchingStatus, vmLocation, extDeptDist, weeklyVmGaps, extPatchingStatus,
           weeklyLocationPatching, weeklyDepartmentPatching] = await Promise.all([
      invQ, extQ, osQ, statusQ, locQ, eolQ, recentQ, weeklyQ,
      mslQ, extComplianceQ, nameConflictQ, locationCountQ,
      activeStatusQ, patchingStatusQ, vmLocationQ, extDeptDistQ,
      weeklyVmGapsQ, extPatchingStatusQ,
      weeklyLocationPatchingQ, weeklyDepartmentPatchingQ,
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
        mslNumerator:   mslRow.rows[0].msl,
        mslDenominator: mslRow.rows[0].msl,
        extNumerator:   extComp.rows[0].with_password,
        extDenominator: extComp.rows[0].total,
        combinedNumerator:   mslRow.rows[0].msl + extComp.rows[0].with_password,
        combinedDenominator: mslRow.rows[0].msl + extComp.rows[0].total,
        locations: locationCount.rows,
      },

      extEndpointCompliance: {
        total:           extComp.rows[0].total,
        withPassword:    extComp.rows[0].with_password,
        meInstalled:     extComp.rows[0].me_installed,
        meNotApplicable: extComp.rows[0].me_not_applicable,
        nameConflicts:   nameConflict.rows[0].c,
        autoPatching:    extComp.rows[0].auto_patching,
        manualPatching:  extComp.rows[0].manual_patching,
      },

      assetInventoryActiveStatus: activeStatus.rows[0],
      assetInventoryPatchingStatus: patchingStatus.rows[0],
      extInventoryPatchingStatus:   extPatchingStatus.rows[0],
      vmCountByLocation: vmLocation.rows,
      extDeptDistribution: extDeptDist.rows,
      weeklyVmGaps: weeklyVmGaps.rows[0],
      weeklyLocationPatching:   weeklyLocationPatching.rows,
      weeklyDepartmentPatching: weeklyDepartmentPatching.rows,

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

module.exports = { summary };
