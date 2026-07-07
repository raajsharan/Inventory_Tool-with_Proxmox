const router = require('express').Router();
const ExcelJS = require('exceljs');
const { authenticate, authorize } = require('../middleware/auth');
const db = require('../config/db');
const ApiError = require('../utils/ApiError');

const writeRoles = ['admin', 'superadmin', 'asset_manager'];

const SOURCE_SERVICE = {
  assets:                 () => require('../services/assetService'),
  beijing_assets:         () => require('../services/beijingAssetService'),
  ext_assets:             () => require('../services/extAssetService'),
  physical_esxi_servers:  () => require('../services/physicalEsxiService'),
};

// ── GET /api/decommissioned — currently decommissioned assets, all sources ──
router.get('/', authenticate, async (req, res, next) => {
  try {
    const { rows } = await db.query(`
      SELECT u.*, usr.full_name AS decommissioned_by_name
        FROM (
          SELECT id, vm_name, os_hostname, ip_address::text AS ip_address, asset_tag,
                 os_type, location, hosted_ip, decommissioned_at, decommissioned_by,
                 'assets' AS source
            FROM assets WHERE deleted_at IS NULL AND decommissioned_at IS NOT NULL
          UNION ALL
          SELECT id, vm_name, os_hostname, ip_address::text, asset_tag, os_type, location,
                 hosted_ip, decommissioned_at, decommissioned_by, 'beijing_assets'
            FROM beijing_assets WHERE deleted_at IS NULL AND decommissioned_at IS NOT NULL
          UNION ALL
          SELECT id, vm_name, os_hostname, ip_address::text, asset_tag, os_type, location,
                 hosted_ip, decommissioned_at, decommissioned_by, 'ext_assets'
            FROM ext_assets WHERE deleted_at IS NULL AND decommissioned_at IS NOT NULL
          UNION ALL
          SELECT id, vm_name, os_hostname, ip_address::text, asset_tag, os_type, location,
                 hosted_ip, decommissioned_at, decommissioned_by, 'physical_esxi_servers'
            FROM physical_esxi_servers WHERE deleted_at IS NULL AND decommissioned_at IS NOT NULL
        ) u
        LEFT JOIN users usr ON usr.id = u.decommissioned_by
       ORDER BY u.decommissioned_at DESC`);
    res.json({ items: rows, total: rows.length });
  } catch (e) { next(e); }
});

// ── GET /api/decommissioned/log — the permanent decommission report ─────────
router.get('/log', authenticate, async (req, res, next) => {
  try {
    const { source, person, from, to } = req.query;
    const where = [];
    const params = [];
    if (source) { params.push(source);            where.push(`source = $${params.length}`); }
    if (person) { params.push(`%${person}%`);     where.push(`decommissioned_by_name ILIKE $${params.length}`); }
    if (from)   { params.push(from);              where.push(`decommissioned_at >= $${params.length}::date`); }
    if (to)     { params.push(to);                where.push(`decommissioned_at < ($${params.length}::date + INTERVAL '1 day')`); }
    const sql = `
      SELECT * FROM decommission_log
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY decommissioned_at DESC
      LIMIT 1000`;
    const { rows } = await db.query(sql, params);
    res.json({ items: rows, total: rows.length });
  } catch (e) { next(e); }
});

// ── GET /api/decommissioned/log/export — Excel report ───────────────────────
router.get('/log/export', authenticate, async (req, res, next) => {
  try {
    const { rows } = await db.query(
      `SELECT * FROM decommission_log ORDER BY decommissioned_at DESC LIMIT 5000`);
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Decommission Report');
    ws.columns = [
      { header: 'VM Name',           key: 'vm_name',                width: 24 },
      { header: 'OS Hostname',       key: 'os_hostname',            width: 24 },
      { header: 'IP Address',        key: 'ip_address',             width: 16 },
      { header: 'Asset Tag',         key: 'asset_tag',              width: 12 },
      { header: 'Serial Number',     key: 'serial_number',          width: 18 },
      { header: 'OS',                key: 'os_type',                width: 14 },
      { header: 'Location',          key: 'location',               width: 14 },
      { header: 'Hosted On',         key: 'hosted_ip',              width: 16 },
      { header: 'Source Inventory',  key: 'source',                 width: 20 },
      { header: 'Decommissioned By', key: 'decommissioned_by_name', width: 20 },
      { header: 'Decommissioned At', key: 'decommissioned_at',      width: 22 },
      { header: 'Reason',            key: 'reason',                 width: 34 },
      { header: 'Reactivated By',    key: 'reactivated_by_name',    width: 20 },
      { header: 'Reactivated At',    key: 'reactivated_at',         width: 22 },
    ];
    ws.getRow(1).font = { bold: true };
    for (const r of rows) {
      ws.addRow({
        ...r,
        decommissioned_at: r.decommissioned_at ? new Date(r.decommissioned_at).toLocaleString() : '',
        reactivated_at:    r.reactivated_at    ? new Date(r.reactivated_at).toLocaleString()    : '',
      });
    }
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="decommission-report.xlsx"');
    await wb.xlsx.write(res);
    res.end();
  } catch (e) { next(e); }
});

// ── POST /api/decommissioned/:source/:id/reactivate ─────────────────────────
router.post('/:source/:id/reactivate', authenticate, authorize(...writeRoles), async (req, res, next) => {
  try {
    const getSvc = SOURCE_SERVICE[req.params.source];
    if (!getSvc) throw new ApiError(400, 'Unknown source inventory');
    const newStatus = req.body?.serverStatus || 'Active';
    if (/^decom/i.test(newStatus)) throw new ApiError(400, 'Reactivation status cannot be Decommissioned');
    const updated = await getSvc().update(req.params.id, { serverStatus: newStatus }, req.user.id);
    res.json(updated);
  } catch (e) { next(e); }
});

module.exports = router;
