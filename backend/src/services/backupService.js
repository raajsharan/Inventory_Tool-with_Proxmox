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
  // Prefer PG* vars; fall back to the app's DB_* vars so pg_dump uses the
  // correct role even when running as a non-postgres OS user.
  const password = process.env.PGPASSWORD || process.env.DB_PASSWORD;
  if (password) env.PGPASSWORD = password;
  return env;
}

function pgConnArgs() {
  const url = process.env.DATABASE_URL;
  if (url) return ['--dbname', url];
  const host = process.env.PGHOST     || process.env.DB_HOST;
  const port = process.env.PGPORT     || process.env.DB_PORT;
  const user = process.env.PGUSER     || process.env.DB_USER;
  const name = process.env.PGDATABASE || process.env.DB_NAME;
  const args = [];
  if (host) args.push('-h', host);
  if (port) args.push('-p', String(port));
  if (user) args.push('-U', user);
  if (name) args.push('-d', name);
  return args;
}

function dbName() {
  if (process.env.PGDATABASE) return process.env.PGDATABASE;
  if (process.env.DB_NAME)    return process.env.DB_NAME;
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

// ---------------------------------------------------------------------
// CSV restore — per-inventory, by date.
// Files in the configured csv directory follow the naming convention
// "<table>_YYYYMMDD-HHMMSS.csv". This function discovers them and groups
// them by table so the UI can offer a date picker.
// ---------------------------------------------------------------------
async function listCsvFiles({ table }) {
  const settings = await getSettings('csv');
  const dir = settings?.directory || '/backups/csv';
  let entries = [];
  try { entries = await fsp.readdir(dir); } catch { return { dir, files: [] }; }
  const out = [];
  for (const name of entries) {
    if (!name.endsWith('.csv')) continue;
    const m = name.match(/^(assets|beijing_assets|ext_assets|physical_esxi_servers)_(\d{8})-(\d{6})\.csv$/);
    if (!m) continue;
    const [, tbl, ymd, hms] = m;
    if (table && table !== tbl) continue;
    const iso = `${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}T${hms.slice(0, 2)}:${hms.slice(2, 4)}:${hms.slice(4, 6)}`;
    let size = 0;
    try { size = (await fsp.stat(path.join(dir, name))).size; } catch {}
    out.push({ filename: name, table: tbl, takenAt: iso, size });
  }
  out.sort((a, b) => b.takenAt.localeCompare(a.takenAt));
  return { dir, files: out };
}

function parseCsvLine(line) {
  const out = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') q = false;
      else cur += ch;
    } else {
      if (ch === ',') { out.push(cur); cur = ''; }
      else if (ch === '"') q = true;
      else cur += ch;
    }
  }
  out.push(cur);
  return out;
}

function coerceCsvValue(v) {
  if (v === '' || v === 'NULL') return null;
  if (v === 'true' || v === 'TRUE')  return true;
  if (v === 'false' || v === 'FALSE') return false;
  return v;
}

async function restoreTableFromCsv({ table, buffer, mode, userId }) {
  if (!INVENTORY_TABLES.includes(table)) {
    throw new ApiError(400, `Restore not allowed for table: ${table}`);
  }
  const text = buffer.toString('utf8').replace(/^﻿/, '');
  const lines = text.split(/\r?\n/).filter(l => l.length > 0);
  if (!lines.length) throw new ApiError(400, 'CSV file is empty');

  const headers = parseCsvLine(lines[0]);
  // Validate column names to prevent SQL injection via crafted CSV headers
  const safeColRe = /^[a-zA-Z_][a-zA-Z0-9_]{0,63}$/;
  for (const h of headers) {
    if (h && !safeColRe.test(h)) throw new ApiError(400, `Invalid column name in CSV: "${h}"`);
  }
  const rows = lines.slice(1).map(parseCsvLine).map(cols => {
    const obj = {};
    headers.forEach((h, i) => { obj[h] = coerceCsvValue(cols[i] ?? ''); });
    return obj;
  });

  const startedAt = new Date();
  const client = await db.getClient();
  let inserted = 0;
  let skipped = 0;
  try {
    await client.query('BEGIN');
    if (mode === 'replace') {
      await client.query(`TRUNCATE TABLE ${table} RESTART IDENTITY CASCADE`);
    }
    for (const row of rows) {
      // Drop columns the live schema doesn't have (defensive: schema may have evolved).
      const cols = Object.keys(row).filter(c => row[c] !== undefined);
      if (!cols.length) continue;
      const vals = cols.map(c => row[c]);
      const placeholders = cols.map((_, i) => `$${i + 1}`).join(',');
      try {
        if (mode === 'merge') {
          const updates = cols.filter(c => c !== 'id').map(c => `${c} = EXCLUDED.${c}`).join(',');
          await client.query(
            `INSERT INTO ${table} (${cols.join(',')}) VALUES (${placeholders})
             ON CONFLICT (id) DO UPDATE SET ${updates || 'id = ' + table + '.id'}`,
            vals
          );
        } else {
          await client.query(
            `INSERT INTO ${table} (${cols.join(',')}) VALUES (${placeholders})`,
            vals
          );
        }
        inserted++;
      } catch (e) {
        skipped++;
        if (mode === 'replace') {
          await client.query('ROLLBACK');
          throw new ApiError(500, `Row failed in replace mode (transaction aborted): ${e.message}`);
        }
      }
    }
    await client.query('COMMIT');
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch {}
    await recordRun({
      kind: 'csv', trigger: 'manual', status: 'error',
      filePath: `restore:${table}`, error: e.message, triggeredBy: userId, startedAt,
    });
    throw e;
  } finally {
    client.release();
  }
  await recordRun({
    kind: 'csv', trigger: 'manual', status: 'ok',
    filePath: `restore:${table}`, fileSize: buffer.length, triggeredBy: userId, startedAt,
  });
  return { table, mode, totalRows: rows.length, inserted, skipped };
}

async function restoreTableFromHistoricalFile({ table, filename, mode, userId }) {
  const settings = await getSettings('csv');
  const dir = settings?.directory || '/backups/csv';
  const filePath = path.join(dir, filename);
  if (!filePath.startsWith(path.resolve(dir))) {
    throw new ApiError(400, 'Invalid file path');
  }
  if (!filename.endsWith('.csv')) throw new ApiError(400, 'Not a CSV file');
  if (!filename.startsWith(`${table}_`)) throw new ApiError(400, 'File does not belong to the selected inventory');
  let buf;
  try { buf = await fsp.readFile(filePath); }
  catch { throw new ApiError(404, 'Backup file not found'); }
  return restoreTableFromCsv({ table, buffer: buf, mode, userId });
}

module.exports = {
  INVENTORY_TABLES,
  getSettings, updateSettings, listRuns,
  runPgBackup, runCsvExport, restoreFromDump,
  listCsvFiles, restoreTableFromCsv, restoreTableFromHistoricalFile,
};
