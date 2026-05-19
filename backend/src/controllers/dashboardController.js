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

    const [inv, ext, os, st, lo, eol, recent, weekly] = await Promise.all([
      invQ, extQ, osQ, statusQ, locQ, eolQ, recentQ, weeklyQ,
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
