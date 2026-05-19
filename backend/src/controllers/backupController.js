const path = require('path');
const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const svc = require('../services/backupService');
const scheduler = require('../services/backupScheduler');
const audit = require('../services/auditService');
const ApiError = require('../utils/ApiError');

async function getSettings(req, res, next) {
  try {
    const kind = req.params.kind;
    if (!['pg', 'csv'].includes(kind)) throw new ApiError(400, 'Invalid kind');
    res.json(await svc.getSettings(kind));
  } catch (e) { next(e); }
}

async function updateSettings(req, res, next) {
  try {
    const kind = req.params.kind;
    if (!['pg', 'csv'].includes(kind)) throw new ApiError(400, 'Invalid kind');
    const row = await svc.updateSettings(kind, req.body, req.user.id);
    await scheduler.reload(kind);
    await audit.log({ user: req.user, action: 'UPDATE', entityType: 'backup_settings', entityId: kind, ipAddress: req.ip });
    res.json(row);
  } catch (e) { next(e); }
}

async function runPgNow(req, res, next) {
  try {
    const tmpDir = path.join(os.tmpdir(), 'inventory-backup');
    await fsp.mkdir(tmpDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const tmpFile = path.join(tmpDir, `pg_dump_${stamp}.sql`);

    const result = await svc.runPgBackup({
      trigger: 'manual',
      userId: req.user.id,
      downloadTo: tmpFile,
    });
    await audit.log({ user: req.user, action: 'EXPORT', entityType: 'pg_dump', ipAddress: req.ip });

    res.setHeader('Content-Type', 'application/sql');
    res.setHeader('Content-Disposition', `attachment; filename="${result.fileName}"`);
    fs.createReadStream(result.filePath).pipe(res).on('close', () => {
      fsp.unlink(result.filePath).catch(() => {});
    });
  } catch (e) { next(e); }
}

async function runCsvNow(req, res, next) {
  try {
    const targets = Array.isArray(req.body?.targets) ? req.body.targets : undefined;
    const { files } = await svc.runCsvExport({
      trigger: 'manual',
      userId: req.user.id,
      targets,
    });
    await audit.log({ user: req.user, action: 'EXPORT', entityType: 'csv', details: { files: files.map(f => path.basename(f.file)) }, ipAddress: req.ip });

    if (files.length === 1) {
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="${path.basename(files[0].file)}"`);
      fs.createReadStream(files[0].file).pipe(res);
      return;
    }
    res.json({ files: files.map(f => ({ name: path.basename(f.file), rows: f.count })) });
  } catch (e) { next(e); }
}

async function listRuns(req, res, next) {
  try {
    const kind = req.params.kind;
    if (!['pg', 'csv'].includes(kind)) throw new ApiError(400, 'Invalid kind');
    res.json({ items: await svc.listRuns(kind) });
  } catch (e) { next(e); }
}

async function restoreDump(req, res, next) {
  try {
    if (!req.file) throw new ApiError(400, 'No file uploaded');
    if (req.user.role !== 'superadmin' && req.user.role !== 'admin') {
      throw new ApiError(403, 'Only admins can restore');
    }
    const tmpDir = path.join(os.tmpdir(), 'inventory-restore');
    await fsp.mkdir(tmpDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const tmpFile = path.join(tmpDir, `restore_${stamp}.sql`);
    await fsp.writeFile(tmpFile, req.file.buffer);

    try {
      await svc.restoreFromDump(tmpFile, { dropFirst: true, userId: req.user.id });
      await audit.log({ user: req.user, action: 'IMPORT', entityType: 'pg_restore', ipAddress: req.ip });
      res.json({ ok: true, message: 'Database restored from dump.' });
    } finally {
      fsp.unlink(tmpFile).catch(() => {});
    }
  } catch (e) { next(e); }
}

module.exports = { getSettings, updateSettings, runPgNow, runCsvNow, listRuns, restoreDump };
