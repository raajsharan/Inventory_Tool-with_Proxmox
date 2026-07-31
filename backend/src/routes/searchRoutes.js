const router = require('express').Router();
const { authenticate } = require('../middleware/auth');
const db = require('../config/db');

// GET /api/search?q=<text> — find assets by name / hostname / IP across all
// four inventories. Powers the global Ctrl+K search.
router.get('/', authenticate, async (req, res, next) => {
  try {
    const q = String(req.query.q || '').trim();
    if (q.length < 2) return res.json({ items: [] });
    const like = `%${q}%`;
    // Decommissioned records stay searchable — they're still real rows in
    // their original table (just filtered out of the active list view) and
    // still resolve at their normal detail route. Only truly deleted rows
    // (soft-deleted to the Recycle Bin) are excluded here.
    const { rows } = await db.query(
      `SELECT * FROM (
         SELECT id, vm_name, os_hostname, ip_address::text AS ip_address, os_type,
                (decommissioned_at IS NOT NULL) AS decommissioned,
                'assets' AS source
           FROM assets
          WHERE deleted_at IS NULL
            AND (vm_name ILIKE $1 OR os_hostname ILIKE $1 OR ip_address::text ILIKE $1)
         UNION ALL
         SELECT id, vm_name, os_hostname, ip_address::text, os_type,
                (decommissioned_at IS NOT NULL), 'beijing_assets'
           FROM beijing_assets
          WHERE deleted_at IS NULL
            AND (vm_name ILIKE $1 OR os_hostname ILIKE $1 OR ip_address::text ILIKE $1)
         UNION ALL
         SELECT id, vm_name, os_hostname, ip_address::text, os_type,
                (decommissioned_at IS NOT NULL), 'ext_assets'
           FROM ext_assets
          WHERE deleted_at IS NULL
            AND (vm_name ILIKE $1 OR os_hostname ILIKE $1 OR ip_address::text ILIKE $1)
         UNION ALL
         SELECT id, vm_name, os_hostname, ip_address::text, os_type,
                (decommissioned_at IS NOT NULL), 'physical_esxi_servers'
           FROM physical_esxi_servers
          WHERE deleted_at IS NULL
            AND (vm_name ILIKE $1 OR os_hostname ILIKE $1 OR ip_address::text ILIKE $1)
       ) _u
       ORDER BY (vm_name ILIKE $2) DESC, vm_name
       LIMIT 20`,
      [like, `${q}%`],
    );
    res.json({ items: rows });
  } catch (e) { next(e); }
});

module.exports = router;
