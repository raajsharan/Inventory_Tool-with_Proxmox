const dbSvc     = require('../services/dbImportService');
const smartSvc  = require('../services/smartImportService');
const audit     = require('../services/auditService');
const db        = require('../config/db');

const CONFIGS = {
  assets:               { table: 'assets',               cols: require('../services/assetService').ASSET_COLUMNS,        service: require('../services/assetService') },
  beijing_assets:       { table: 'beijing_assets',       cols: require('../services/beijingAssetService').ASSET_COLUMNS,  service: require('../services/beijingAssetService') },
  ext_assets:           { table: 'ext_assets',           cols: require('../services/extAssetService').ASSET_COLUMNS,      service: require('../services/extAssetService') },
  physical_esxi_servers:{ table: 'physical_esxi_servers',cols: require('../services/physicalEsxiService').ASSET_COLUMNS,  service: require('../services/physicalEsxiService') },
};

function creds(body) {
  return { host: body.host, port: body.port, database: body.database, user: body.user, password: body.password, ssl: body.ssl };
}

async function testConnection(req, res, next) {
  try {
    const result = await dbSvc.testConnection(creds(req.body));
    res.json(result);
  } catch (e) {
    // Surface DB-level errors (auth failure, connection refused, etc.) as 400
    const err = new Error(e.message || 'Connection failed');
    err.status = 400;
    next(err);
  }
}

async function fetchColumns(req, res, next) {
  try {
    const { table, query } = req.body;
    const result    = await dbSvc.fetchColumns(creds(req.body), { table, query });
    const suggested = dbSvc.suggestMapping(result.columns);
    res.json({ ...result, suggested });
  } catch (e) {
    const err = new Error(e.message || 'Failed to fetch columns');
    err.status = 400;
    next(err);
  }
}

async function preview(req, res, next) {
  try {
    const { table, query, columnMap, targetTable, verifyByIp } = req.body;
    const cfg = CONFIGS[targetTable];
    if (!cfg) return res.status(400).json({ error: 'Invalid target table' });

    const { rows: srcRows } = await dbSvc.fetchRows(creds(req.body), { table, query });
    const mappedRows = srcRows.map((row, i) => ({
      rowIdx: i + 1,
      data:   dbSvc.applyColumnMap(row, columnMap || {}),
    }));

    const result = await smartSvc.previewRows(mappedRows, {
      table: cfg.table, cols: cfg.cols, verifyByIp: verifyByIp === true || verifyByIp === 'true',
    });
    res.json(result);
  } catch (e) { next(e); }
}

async function apply(req, res, next) {
  try {
    const { table, query, columnMap, targetTable, verifyByIp, selectedRowIdxs } = req.body;
    const cfg = CONFIGS[targetTable];
    if (!cfg) return res.status(400).json({ error: 'Invalid target table' });

    const { rows: srcRows } = await dbSvc.fetchRows(creds(req.body), { table, query });
    const mappedRows = srcRows.map((row, i) => ({
      rowIdx: i + 1,
      data:   dbSvc.applyColumnMap(row, columnMap || {}),
    }));

    const result = await smartSvc.applyRows(mappedRows, {
      table: cfg.table, cols: cfg.cols,
      verifyByIp: verifyByIp === true || verifyByIp === 'true',
      selectedRowIdxs,
      createFn:        cfg.service.create.bind(cfg.service),
      updateRowDirect: cfg.service.update.bind(cfg.service),
    }, req.user);

    await db.query(
      `INSERT INTO import_logs (filename, total_rows, success_rows, failed_rows, error_details, imported_by)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [`db-import-${targetTable}`, result.selected, result.success, result.failed,
       JSON.stringify(result.failures), req.user?.id || null]
    );
    await audit.log({
      user: req.user, action: 'IMPORT', entityType: targetTable,
      details: { mode: 'db_import', source: table || 'custom_query', ...result, successes: undefined, failures: undefined },
      ipAddress: req.ip,
    });
    res.json(result);
  } catch (e) { next(e); }
}

module.exports = { testConnection, fetchColumns, preview, apply };
