const db = require('../config/db');
const ApiError = require('../utils/ApiError');
const assetService = require('./assetService');
const beijingAssetService = require('./beijingAssetService');
const extAssetService = require('./extAssetService');

// The three inventories share the exact same ASSET_COLUMNS whitelist and
// create()/remove() shape, which is what makes a generic transfer possible
// without duplicating per-table logic (auto tag assignment, dup checks,
// decommission bookkeeping all still run via each service's own create()).
const INVENTORIES = {
  assets:         { table: 'assets',         label: 'Asset Inventory',      svc: assetService },
  beijing_assets: { table: 'beijing_assets', label: 'Beijing Asset List',   svc: beijingAssetService },
  ext_assets:     { table: 'ext_assets',      label: 'Ext. Asset Inventory', svc: extAssetService },
};

function assertInventory(key) {
  const inv = INVENTORIES[key];
  if (!inv) throw new ApiError(400, `Unknown inventory "${key}"`);
  return inv;
}

async function preview({ source, ids }) {
  const src = assertInventory(source);
  if (!Array.isArray(ids) || !ids.length) throw new ApiError(400, 'No records selected');
  const { rows } = await db.query(
    `SELECT id, vm_name, ip_address, asset_type, server_status
       FROM ${src.table} WHERE id = ANY($1::uuid[]) AND deleted_at IS NULL`,
    [ids]
  );
  return rows;
}

// Moves each record: remove from source FIRST (soft-delete), then create in
// target. Order matters — the target's create() runs a cross-inventory
// duplicate check (IP/asset tag) that scans all inventories INCLUDING the
// source table, so removing first keeps the record from colliding with
// itself. If create() then fails, the record is left soft-deleted in the
// source (recoverable from Recycle Bin) rather than duplicated or lost.
async function transfer({ source, target, ids }, userId) {
  if (source === target) throw new ApiError(400, 'Source and target inventory must be different');
  const src = assertInventory(source);
  const tgt = assertInventory(target);
  if (!Array.isArray(ids) || !ids.length) throw new ApiError(400, 'No records selected');

  const moved = [];
  const failed = [];

  for (const id of ids) {
    let removedFromSource = false;
    try {
      const { rows } = await db.query(
        `SELECT * FROM ${src.table} WHERE id = $1 AND deleted_at IS NULL`, [id]
      );
      const row = rows[0];
      if (!row) throw new ApiError(404, 'Record not found or already moved');

      const body = {};
      for (const c of assetService.ASSET_COLUMNS) body[c] = row[c];

      await src.svc.remove(id, userId);
      removedFromSource = true;

      const created = await tgt.svc.create(body, userId);

      if (row.asset_password_encrypted) {
        await db.query(
          `UPDATE ${tgt.table} SET asset_password_encrypted = $1 WHERE id = $2`,
          [row.asset_password_encrypted, created.id]
        );
      }

      moved.push({ id, newId: created.id, vm_name: row.vm_name });
    } catch (e) {
      failed.push({
        id,
        error: e.message || 'Transfer failed',
        recoverable: removedFromSource,
      });
    }
  }

  return { moved, failed };
}

module.exports = { transfer, preview, INVENTORIES };
