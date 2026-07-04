const ExcelJS  = require('exceljs');
const multer    = require('multer');
const db        = require('../config/db');
const ApiError  = require('../utils/ApiError');

const IP_REGEX = /^(192\.168\.\d{1,3}\.\d{1,3}|10\.\d{1,3}\.\d{1,3}\.\d{1,3})$/;

const EXCEL_MIMES = new Set([
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
]);
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const extOk = /\.xlsx?$/i.test(file.originalname);
    const mimeOk = EXCEL_MIMES.has(file.mimetype);
    if (extOk && mimeOk) return cb(null, true);
    cb(new Error('Only Excel files (.xlsx / .xls) are allowed'));
  },
});
const uploadMiddleware = upload.single('file');

// Case-insensitive header lookup — try each candidate key in order
function getCell(row, headers, ...keys) {
  for (const k of keys) {
    const idx = headers.findIndex(h => h && h.toLowerCase().trim() === k.toLowerCase().trim());
    if (idx !== -1) {
      const cell = row.getCell(idx + 1);
      const val  = cell.text != null && cell.text !== '' ? cell.text : cell.value;
      if (val != null && val !== '') return String(val).trim();
    }
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /tenable/import  (admin only)
// ─────────────────────────────────────────────────────────────────────────────
async function importFile(req, res, next) {
  try {
    if (!req.file) throw new ApiError(400, 'No file uploaded');

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(req.file.buffer);
    const ws = workbook.worksheets[0];
    if (!ws) throw new ApiError(400, 'Excel file has no worksheets');

    // Build header index from row 1
    const headers = [];
    ws.getRow(1).eachCell((cell, colNum) => {
      headers[colNum - 1] = String(cell.text || cell.value || '');
    });

    const rows = [];
    ws.eachRow((row, rowNum) => {
      if (rowNum === 1) return;

      const ipRaw =
        getCell(row, headers, 'ip addresses', 'ipv4_addresses', 'ipv4 addresses', 'ip address', 'ip_address') || '';

      const ipList = ipRaw
        .split(/[,\n\r]+/)
        .map(s => s.trim())
        .filter(ip => IP_REGEX.test(ip));

      if (!ipList.length) return;

      const host_name         = getCell(row, headers, 'host_name', 'dns name', 'hostname', 'host name');
      const name              = getCell(row, headers, 'name');
      const display_mac_address = getCell(row, headers, 'display_mac_address', 'mac address', 'mac_address');
      const last_observed     = getCell(row, headers, 'last_observed', 'last observed');
      const operating_systems = getCell(row, headers, 'operating_systems', 'operating system', 'os');

      for (const ip of ipList) {
        rows.push({ ip_address: ip, host_name, name, display_mac_address, ipv4_addresses: ipRaw, last_observed, operating_systems });
      }
    });

    if (!rows.length) throw new ApiError(400, 'No valid 192.168.x.x or 10.x.x.x IPs found in file');

    // Create import record
    const { rows: [imp] } = await db.query(
      `INSERT INTO tenable_imports (filename, imported_by, total_ips)
       VALUES ($1, $2, $3) RETURNING id`,
      [req.file.originalname, req.user.id, rows.length]
    );
    const importId = imp.id;

    let newIPs = 0, updatedIPs = 0;
    for (const r of rows) {
      const { rows: [res2] } = await db.query(
        `INSERT INTO tenable_assets
           (ip_address, host_name, name, display_mac_address, ipv4_addresses, last_observed, operating_systems, import_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT (ip_address) DO UPDATE SET
           host_name=$2, name=$3, display_mac_address=$4, ipv4_addresses=$5,
           last_observed=$6, operating_systems=$7, import_id=$8, updated_at=NOW()
         RETURNING (xmax = 0) AS inserted`,
        [r.ip_address, r.host_name, r.name, r.display_mac_address, r.ipv4_addresses, r.last_observed, r.operating_systems, importId]
      );
      if (res2.inserted) newIPs++; else updatedIPs++;
    }

    await db.query(
      `UPDATE tenable_imports SET new_ips=$1, updated_ips=$2 WHERE id=$3`,
      [newIPs, updatedIPs, importId]
    );

    res.json({ success: true, import_id: importId, total_ips: rows.length, new_ips: newIPs, updated_ips: updatedIPs });
  } catch (e) { next(e); }
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /tenable/imports
// ─────────────────────────────────────────────────────────────────────────────
async function getImports(req, res, next) {
  try {
    const { rows } = await db.query(
      `SELECT ti.*, u.full_name AS imported_by_name
       FROM tenable_imports ti
       LEFT JOIN users u ON u.id = ti.imported_by
       ORDER BY ti.imported_at DESC
       LIMIT 100`
    );
    res.json({ items: rows });
  } catch (e) { next(e); }
}

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /tenable/imports/:id
// ─────────────────────────────────────────────────────────────────────────────
async function deleteImport(req, res, next) {
  try {
    await db.query(`DELETE FROM tenable_imports WHERE id=$1`, [req.params.id]);
    res.json({ success: true });
  } catch (e) { next(e); }
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /tenable/total-ips
// ─────────────────────────────────────────────────────────────────────────────
async function getTotalIPs(req, res, next) {
  try {
    const { rows } = await db.query(
      `SELECT
         COUNT(*) AS total,
         (SELECT imported_at FROM tenable_imports ORDER BY imported_at DESC LIMIT 1) AS last_import_at,
         (SELECT filename    FROM tenable_imports ORDER BY imported_at DESC LIMIT 1) AS last_filename
       FROM tenable_assets`
    );
    res.json({
      total_ips:      parseInt(rows[0].total, 10),
      last_import_at: rows[0].last_import_at,
      last_filename:  rows[0].last_filename,
    });
  } catch (e) { next(e); }
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /tenable/report
// ─────────────────────────────────────────────────────────────────────────────
async function getReport(req, res, next) {
  try {
    // All Tenable IPs
    const { rows: tenableRows } = await db.query(`SELECT * FROM tenable_assets ORDER BY ip_address`);
    const tenableMap = new Map(tenableRows.map(r => [r.ip_address, r]));

    // All inventory assets with 192.168 / 10.x IPs
    const { rows: assetRows } = await db.query(`
      SELECT 'Asset Inventory' AS source,
             vm_name, os_hostname, ip_address, asset_type, location, department
      FROM assets
      WHERE deleted_at IS NULL
        AND ip_address ~ '^(192\\.168\\.|10\\.)'
      UNION ALL
      SELECT 'Ext. Asset Inventory',
             vm_name, os_hostname, ip_address, asset_type, location, department
      FROM ext_assets
      WHERE deleted_at IS NULL
        AND ip_address ~ '^(192\\.168\\.|10\\.)'
      UNION ALL
      SELECT 'Beijing Inventory',
             vm_name, os_hostname, ip_address, asset_type, location, department
      FROM beijing_assets
      WHERE deleted_at IS NULL
        AND ip_address ~ '^(192\\.168\\.|10\\.)'
      UNION ALL
      SELECT 'Physical / ESXi',
             vm_name, os_hostname, ip_address, asset_type, location, department
      FROM physical_esxi_servers
      WHERE deleted_at IS NULL
        AND ip_address ~ '^(192\\.168\\.|10\\.)'
    `);

    const matched      = [];
    const notInTenable = [];
    const matchedIPs   = new Set();

    for (const asset of assetRows) {
      const ta = tenableMap.get(asset.ip_address);
      if (ta) {
        matchedIPs.add(asset.ip_address);
        matched.push({
          source:       asset.source,
          asset_name:   asset.vm_name || asset.os_hostname || '',
          matched_ip:   asset.ip_address,
          all_ips:      asset.ip_address,
          asset_type:   asset.asset_type   || '',
          tenable_host: ta.host_name        || '',
          tenable_name: ta.name             || '',
          mac_address:  ta.display_mac_address || '',
          last_observed: ta.last_observed   || '',
          os:           ta.operating_systems || '',
          location:     asset.location      || '',
          department:   asset.department    || '',
        });
      } else {
        notInTenable.push({
          source:     asset.source,
          asset_name: asset.vm_name || asset.os_hostname || '',
          ip_address: asset.ip_address,
          all_ips:    asset.ip_address,
          asset_type: asset.asset_type  || '',
          location:   asset.location    || '',
          department: asset.department  || '',
        });
      }
    }

    const tenableOnly = tenableRows
      .filter(r => !matchedIPs.has(r.ip_address))
      .map(r => ({
        ip_address:        r.ip_address,
        host_name:         r.host_name          || '',
        name:              r.name               || '',
        mac_address:       r.display_mac_address || '',
        all_ips:           r.ipv4_addresses      || r.ip_address,
        last_observed:     r.last_observed       || '',
        operating_systems: r.operating_systems   || '',
      }));

    res.json({
      matched,
      not_in_tenable:  notInTenable,
      tenable_only:    tenableOnly,
      summary: {
        total_tenable_ips:    tenableRows.length,
        matched_count:        matched.length,
        not_in_tenable_count: notInTenable.length,
        tenable_only_count:   tenableOnly.length,
      },
    });
  } catch (e) { next(e); }
}

module.exports = { uploadMiddleware, importFile, getImports, deleteImport, getTotalIPs, getReport };
