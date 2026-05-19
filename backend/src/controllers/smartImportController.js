const svc = require('../services/smartImportService');
const audit = require('../services/auditService');
const db = require('../config/db');

const CONFIGS = {
  assets: {
    table: 'assets',
    cols: require('../services/assetService').ASSET_COLUMNS,
    service: require('../services/assetService'),
  },
  beijing_assets: {
    table: 'beijing_assets',
    cols: require('../services/beijingAssetService').ASSET_COLUMNS,
    service: require('../services/beijingAssetService'),
  },
  ext_assets: {
    table: 'ext_assets',
    cols: require('../services/extAssetService').ASSET_COLUMNS,
    service: require('../services/extAssetService'),
  },
  physical_esxi_servers: {
    table: 'physical_esxi_servers',
    cols: require('../services/physicalEsxiService').ASSET_COLUMNS,
    service: require('../services/physicalEsxiService'),
  },
};

function makePreview(kind) {
  return async function (req, res, next) {
    try {
      if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
      const cfg = CONFIGS[kind];
      const verifyByIp = String(req.query.verifyByIp || req.body?.verifyByIp || 'false') === 'true';
      const result = await svc.preview(req.file.buffer, {
        table: cfg.table, cols: cfg.cols, verifyByIp,
      });
      res.json(result);
    } catch (e) { next(e); }
  };
}

function makeApply(kind) {
  return async function (req, res, next) {
    try {
      if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
      const cfg = CONFIGS[kind];
      const verifyByIp = String(req.query.verifyByIp || req.body?.verifyByIp || 'false') === 'true';
      let selectedRowIdxs = req.body?.selectedRowIdxs;
      if (typeof selectedRowIdxs === 'string') {
        try { selectedRowIdxs = JSON.parse(selectedRowIdxs); }
        catch { selectedRowIdxs = selectedRowIdxs.split(',').map(s => parseInt(s, 10)).filter(Boolean); }
      }
      const result = await svc.apply(req.file.buffer, {
        table: cfg.table, cols: cfg.cols, verifyByIp, selectedRowIdxs,
        createFn: cfg.service.create.bind(cfg.service),
        updateRowDirect: cfg.service.update.bind(cfg.service),
      }, req.user);

      await db.query(
        `INSERT INTO import_logs (filename, total_rows, success_rows, failed_rows, error_details, imported_by)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [`smart-import-${kind}.xlsx`, result.selected, result.success, result.failed,
         JSON.stringify(result.failures), req.user?.id || null]
      );
      await audit.log({
        user: req.user,
        action: 'IMPORT',
        entityType: kind,
        details: { mode: verifyByIp ? 'verify_by_ip' : 'standard', ...result, successes: undefined, failures: undefined },
        ipAddress: req.ip,
      });
      res.json(result);
    } catch (e) { next(e); }
  };
}

module.exports = { makePreview, makeApply };
