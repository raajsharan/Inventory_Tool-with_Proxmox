/**
 * vmwareAssetEditorService.js
 * ---------------------------
 * CRUD for local VM edit overrides stored in vmware_asset_edits.
 */

const db = require('../config/db');

const EDITABLE = ['asset_name', 'hostname', 'ip_address', 'os_type', 'os_version', 'notes'];

// Load all edits keyed by "source_host|||vm_name" (lowercased)
async function loadAllEdits() {
  const { rows } = await db.query(
    `SELECT id, source_host, vm_name, asset_name, hostname, ip_address,
            os_type, os_version, notes,
            to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI UTC') AS updated_at
     FROM vmware_asset_edits`
  );
  const map = {};
  for (const r of rows) {
    const key = `${(r.source_host || '').toLowerCase()}|||${(r.vm_name || '').toLowerCase()}`;
    map[key] = r;
  }
  return map;
}

// Upsert an edit record
async function saveEdit(sourceHost, vmName, fields) {
  const clean = {};
  for (const f of EDITABLE) {
    clean[f] = (fields[f] || '').trim();
  }

  await db.query(
    `INSERT INTO vmware_asset_edits
       (source_host, vm_name, asset_name, hostname, ip_address, os_type, os_version, notes, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
     ON CONFLICT (source_host, vm_name) DO UPDATE SET
       asset_name = EXCLUDED.asset_name,
       hostname   = EXCLUDED.hostname,
       ip_address = EXCLUDED.ip_address,
       os_type    = EXCLUDED.os_type,
       os_version = EXCLUDED.os_version,
       notes      = EXCLUDED.notes,
       updated_at = NOW()`,
    [sourceHost, vmName, clean.asset_name, clean.hostname, clean.ip_address,
     clean.os_type, clean.os_version, clean.notes]
  );
}

// Delete a single edit record
async function deleteEdit(sourceHost, vmName) {
  const { rowCount } = await db.query(
    `DELETE FROM vmware_asset_edits WHERE source_host = $1 AND vm_name = $2`,
    [sourceHost, vmName]
  );
  return rowCount > 0;
}

// Delete all edits
async function clearAllEdits() {
  const { rowCount } = await db.query(`DELETE FROM vmware_asset_edits`);
  return rowCount;
}

module.exports = { loadAllEdits, saveEdit, deleteEdit, clearAllEdits };
