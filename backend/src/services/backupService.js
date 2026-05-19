const { spawn } = require('child_process');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const db = require('../config/db');
const ApiError = require('../utils/ApiError');

const INVENTORY_TABLES = ['assets', 'beijing_assets', 'ext_assets', 'physical_esxi_servers'];

function nowStamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function pgEnv() {
  const url = process.env.DATABASE_URL;
  const env = { ...process.env };
  if (url) env.DATABASE_URL = url;
  if (process.env.PGPASSWORD) env.PGPASSWORD = process.env.PGPASSWORD;
  return env;
}

function pgConnArgs() {
  const url = process.env.DATABASE_URL;
  if (url) return ['--dbname', url];
  const args = [];
  if (process.env.PGHOST)     args.push('-h', process.env.PGHOST);
  if (process.env.PGPORT)     args.push('-p', process.env.PGPORT);
  if (process.env.PGUSER)     args.push('-U', process.env.PGUSER);
  if (process.env.PGDATABASE) args.push('-d', process.env.PGDATABASE);
  return args;
}

function dbName() {
  if (process.env.PGDATABASE) return process.env.PGDATABASE;
  const url = process.env.DATABASE_URL;
  if (url) {
    const m = url.match(/\/([^/?]+)(?:\?|$)/);
    if (m) return m[1];
  }
  return 'infrastructure_inventory';
}

async function ensureDir(dir) {
  await fsp.mkdir(dir, { recursive: true });
}

async function getSettings(kind) {
  const { rows } = await db.query('SELECT * FROM backup_settings WHERE kind = $1', [kind]);
  return rows[0] || null;
}

async function updateSettings(kind, body, userId) {
  const allowed = ['enabled', 'frequency', 'time_24h', 'day_of_week', 'day_of_month',
    'retain_days', 'directory', 'file_naming', 'csv_targets'];
  const fields = [];
  const vals = [];
  for (const k of allowed) {
    if (body[k] !== undefined) {
      fields.push(`${k} = $${fields.length + 1}`);
      vals.push(k === 'csv_targets' ? JSON.stringify(body[k]) : body[k]);
    }
  }
  if (!fields.length) return getSettings(kind);
  vals.push(userId || null);
  fields.push(`updated_by = $${vals.length}`);
  vals.push(kind);
  const { rows } = await db.query(
    `UPDATE backup_settings SET ${fields.join(', ')} WHERE kind = $${vals.length} RETURNING *`,
    vals
  );
  if (!rows.length) throw new ApiError(404, 'Backup settings not found');
  return rows[0];
}

async function listRuns(kind, limit = 25) {
  const { rows } = await db.query(
    `SELECT r.*, u.full_name AS triggered_by_name
       FROM backup_runs r
       LEFT JOIN users u ON u.id = r.triggered_by
      WHERE r.kind = $1 ORDER BY r.started_at DESC LIMIT $2`,
    [kind, limit]
  );
  return rows;
}

async function recordRun({ kind, trigger, status, filePath, fileSize, error, triggeredBy, startedAt }) {
  const { rows } = await db.query(
    `INSERT INTO backup_runs (kind, trigger, status, file_path, file_size, error, triggered_by, started_at, finished_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8, NOW()) RETURNING *`,
    [kind, trigger, status, filePath || null, fileSize || null, error || null, triggeredBy || null, startedAt || new Date()]
  );
  return rows[0];
}

function runPgDump(filePath) {
  return new Promise((resolve, reject) => {
    const args = [
      ...pgConnArgs(),
      '--no-owner',
      '--no-privileges',
      '-f', filePath,
    ];
    const proc = spawn('pg_dump', args, { env: pgEnv() });
    let stderr = '';
    proc.stderr.on('data', (d) => { stderr += d.toString(); });
    proc.on('error', (e) => reject(new Error(`pg_dump unavailable: ${e.message}`)));
    proc.on('close', (code) => {
      if (code === 0) return resolve();
      reject(new Error(`pg_dump exited ${code}: ${stderr.trim().slice(0, 800)}`));
    });
  });
}

function runPsqlRestore(filePath, { dropFirst }) {
  return new Promise((resolve, reject) => {
    const sql = dropFirst
      ? `DROP SCHEMA public CASCADE; CREATE SCHEMA public; \\i ${filePath.replace(/\\/g, '/')}`
      : `\\i ${filePath.replace(/\\/g, '/')}`;
    const args = [
      ...pgConnArgs(),
      '-v', 'ON_ERROR_STOP=1',
      '-c', sql,
    ];
    const proc = spawn('psql', args, { env: pgEnv() });
    let stderr = '';
    proc.stderr.on('data', (d) => { stderr += d.toString(); });
    proc.on('error', (e) => reject(new Error(`psql unavailable: ${e.message}`)));
    proc.on('close', (code) => {
      if (code === 0) return resolve(stderr.trim());
      reject(new Error(`psql exited ${code}: ${stderr.trim().slice(0, 1200)}`));
    });
  });
}

async function pruneOldFiles(dir, retainDays) {
  if (!retainDays || retainDays <= 0) return;
  const cutoff = Date.now() - retainDays * 86400000;
  let entries;
  try { entries = await fsp.readdir(dir); } catch { return; }
  for (const name of entries) {
    if (!/^(pg_dump|inventory_)|\.(sql|csv|zip)$/.test(name)) continue;
    const full = path.join(dir, name);
    try {
      const st = await fsp.stat(full);
      if (st.mtimeMs < cutoff) await fsp.unlink(full);
    } catch { /* ignore */ }
  }
}

async function runPgBackup({ trigger, userId, downloadTo }) {
  const settings = await getSettings('pg');
  const dir = downloadTo ? path.dirname(downloadTo) : (settings?.directory || '/backups/postgres');
  await ensureDir(dir);
  const stamp = nowStamp();
  const name = settings?.file_naming === 'overwrite'
    ? `inventory_${dbName()}.sql`
    : `inventory_${dbName()}_${stamp}.sql`;
  const filePath = downloadTo || path.join(dir, name);

  const startedAt = new Date();
  try {
    await runPgDump(filePath);
    const st = await fsp.stat(filePath);
    await pruneOldFiles(dir, settings?.retain_days);
    await recordRun({
      kind: 'pg', trigger, status: 'ok',
      filePath, fileSize: st.size, triggeredBy: userId, startedAt,
    });
    return { filePath, fileSize: st.size, fileName: path.basename(filePath) };
  } catch (e) {
    await recordRun({
      kind: 'pg', trigger, status: 'error',
      filePath, error: e.message, triggeredBy: userId, startedAt,
    });
    throw e;
  }
}

function csvEscape(v) {
  if (v === null || v === undefined) return '';
  let s = typeof v === 'object' ? JSON.stringify(v) : String(v);
  if (/[",\r\n]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

async function dumpTableToCsv(table, dir) {
  const safe = INVENTORY_TABLES.includes(table) ? table : null;
  if (!safe) throw new ApiError(400, `CSV export not allowed for table: ${table}`);
  const { rows } = await db.query(`SELECT * FROM ${safe} ORDER BY created_at`);
  const file = path.join(dir, `${safe}_${nowStamp()}.csv`);
  if (!rows.length) {
    await fsp.writeFile(file, '');
    return { file, count: 0 };
  }
  const headers = Object.keys(rows[0]);
  const lines = [headers.join(',')];
  for (const r of rows) {
    lines.push(headers.map(h => csvEscape(r[h])).join(','));
  }
  await fsp.writeFile(file, lines.join('\n'), 'utf8');
  return { file, count: rows.length };
}

async function runCsvExport({ trigger, userId, targets }) {
  const settings = await getSettings('csv');
  const dir = settings?.directory || '/backups/csv';
  await ensureDir(dir);
  const list = (targets && targets.length ? targets : settings?.csv_targets || INVENTORY_TABLES)
    .filter(t => INVENTORY_TABLES.includes(t));
  if (!list.length) throw new ApiError(400, 'No CSV targets selected');

  const startedAt = new Date();
  const exported = [];
  try {
    for (const t of list) exported.push(await dumpTableToCsv(t, dir));
    await pruneOldFiles(dir, settings?.retain_days);
    const totalBytes = (await Promise.all(exported.map(e => fsp.stat(e.file)))).reduce((s, x) => s + x.size, 0);
    await recordRun({
      kind: 'csv', trigger, status: 'ok',
      filePath: exported.map(e => path.basename(e.file)).join('; '),
      fileSize: totalBytes, triggeredBy: userId, startedAt,
    });
    return { files: exported };
  } catch (e) {
    await recordRun({
      kind: 'csv', trigger, status: 'error',
      error: e.message, triggeredBy: userId, startedAt,
    });
    throw e;
  }
}

async function restoreFromDump(filePath, { dropFirst, userId }) {
  const startedAt = new Date();
  try {
    await runPsqlRestore(filePath, { dropFirst });
    await recordRun({
      kind: 'pg', trigger: 'manual', status: 'ok',
      filePath: `restore:${path.basename(filePath)}`,
      triggeredBy: userId, startedAt,
    });
    return { ok: true };
  } catch (e) {
    await recordRun({
      kind: 'pg', trigger: 'manual', status: 'error',
      filePath: `restore:${path.basename(filePath)}`,
      error: e.message, triggeredBy: userId, startedAt,
    });
    throw e;
  }
}

module.exports = {
  INVENTORY_TABLES,
  getSettings, updateSettings, listRuns,
  runPgBackup, runCsvExport, restoreFromDump,
};
