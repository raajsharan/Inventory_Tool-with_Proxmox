/**
 * weeklyReportTablesService.js
 * ----------------------------
 * Implements WEEKLY_REPORT_CONFIG.md for the Weekly Report page:
 *   weekly_report_tables         one row per report table (order, enabled, columns)
 *   weekly_report_pivot_options  single row: what end users may pivot on
 *   weekly_report_views          per-user saved pivot views
 *
 * Two kinds of table live in weekly_report_tables:
 *   kind 'pivot' — the built-in aggregated tables (Location patching, ...). Their
 *                  calculation rules sit in config.rules and are read by the
 *                  report engine through weeklyPivotConfigService.getConfig().
 *   kind 'rows'  — admin-defined detail tables: source + columns + excluded
 *                  statuses, rendered straight from the inventories.
 *
 * Security: every field key is checked against FIELDS (no passwords, no
 * encrypted columns) and only ever interpolated after that check; all values
 * go through $n placeholders.
 */
const db = require('../config/db');
const pivotSvc = require('./weeklyPivotConfigService');

const SOURCES = [
  { key: 'assets',                label: 'Assets',          table: 'assets' },
  { key: 'beijing_assets',        label: 'Beijing Assets',  table: 'beijing_assets' },
  { key: 'ext_assets',            label: 'Ext. Assets',     table: 'ext_assets' },
  { key: 'physical_esxi_servers', label: 'Physical & ESXi', table: 'physical_esxi_servers' },
];

// Columns present in (or safely NULL for) all four inventories.
const FIELDS = [
  { key: 'vm_name',       label: 'VM Name',          format: 'text' },
  { key: 'os_hostname',   label: 'Hostname',         format: 'text' },
  { key: 'ip_address',    label: 'IP Address',       format: 'text' },
  { key: 'os_type',       label: 'Operating System', format: 'text' },
  { key: 'department',    label: 'Department',       format: 'text' },
  { key: 'location',      label: 'Location',         format: 'text' },
  { key: 'server_status', label: 'Status',           format: 'tag'  },
  { key: 'patching_type', label: 'Patching Type',    format: 'text' },
  { key: 'eol_status',    label: 'EOL Status',       format: 'text' },
  { key: 'asset_type',    label: 'Asset Type',       format: 'text' },
  { key: 'asset_tag',     label: 'Asset Tag',        format: 'text' },
  { key: 'assigned_user', label: 'Assigned User',    format: 'text' },
  { key: 'serial_number', label: 'Serial Number',    format: 'text' },
  { key: 'source',        label: 'Inventory',        format: 'text' },
];
const FIELD_KEYS = new Set(FIELDS.map(f => f.key));
const FORMATS = ['text', 'tag', 'date', 'boolean'];
// Not offered to end users as pivot dimensions (too many distinct values).
const HIGH_CARDINALITY = new Set(['vm_name', 'os_hostname', 'ip_address', 'asset_tag', 'serial_number', 'assigned_user']);
const PHYSICAL_NULL = new Set(['patching_type', 'eol_status']);
const ALWAYS_EXCLUDED = ['na', 'not in scope'];

const LIMITS = { tables: 20, columns: 30, minWidth: 60, maxWidth: 600, label: 60 };

const DEFAULT_OPTIONS = {
  allow_pivot: true,
  row_fields: ['department', 'server_status', 'os_type', 'location', 'patching_type', 'eol_status', 'asset_type', 'source'],
  value_options: ['count', 'pct', 'rowpct'],
  default_rows: 'department',
  default_cols: 'server_status',
};

const str = (v, n = 200) => String(v ?? '').trim().slice(0, n);
const strList = (v, n = 50) => (Array.isArray(v) ? v : []).map(x => str(x, 80)).filter(Boolean)
  .filter((x, i, a) => a.indexOf(x) === i).slice(0, n);

// ── built-in table definitions ─────────────────────────────────────────────
function pivotColumns(meta, rules) {
  const hidden = rules.hidden_columns || [];
  const labels = rules.column_labels || {};
  return (meta.columns || []).map((c, i) => ({
    key: c.key, label: labels[c.key] || c.label, visible: !hidden.includes(c.key),
    order: i + 1, width: 120, sortable: false, format: 'text',
  }));
}

function builtinRows() {
  const meta = pivotSvc.getMeta();
  return meta.tables.map((t, i) => {
    const rules = JSON.parse(JSON.stringify(meta.defaults[t.key]));
    return {
      table_key: t.key, title: rules.title || t.title, enabled: true, sort_order: i + 1,
      config: { kind: 'pivot', source: 'all', groupBy: rules.group_by || null,
        excludeStatuses: [], columns: pivotColumns(t, rules), rules },
    };
  });
}

// ── sanitizing ─────────────────────────────────────────────────────────────
function sanitizeColumns(cols, { fixedKeys } = {}) {
  const allowed = (k) => (fixedKeys ? fixedKeys.includes(k) : FIELD_KEYS.has(k));
  const seen = new Set();
  return (Array.isArray(cols) ? cols : [])
    .filter(c => c && allowed(c.key) && !seen.has(c.key) && seen.add(c.key))
    .slice(0, LIMITS.columns)
    .map((c, i) => {
      const w = Number(c.width);
      return {
        key: c.key,
        label: str(c.label, LIMITS.label),
        visible: c.visible !== false,
        order: Number.isFinite(Number(c.order)) ? Number(c.order) : i + 1,
        width: Number.isFinite(w) ? Math.min(LIMITS.maxWidth, Math.max(LIMITS.minWidth, Math.round(w))) : 140,
        sortable: !!c.sortable,
        format: FORMATS.includes(c.format) ? c.format : 'text',
      };
    })
    .sort((a, b) => a.order - b.order)
    .map((c, i) => ({ ...c, order: i + 1 }));
}

function sanitizeTable(t, prev) {
  const key = str(t.table_key, 64).replace(/[^a-z0-9_]/gi, '_').toLowerCase();
  if (!key) throw new Error('table_key is required');
  const cfg = t.config || {};
  const builtin = pivotSvc.getMeta().tables.find(x => x.key === key);
  const base = {
    table_key: key,
    title: str(t.title, 120) || (builtin?.title ?? key),
    enabled: t.enabled !== false,
    sort_order: Number.isFinite(Number(t.sort_order)) ? Number(t.sort_order) : 0,
  };
  if (builtin) {
    // Rules go through the engine's own sanitizer; columns can only be the
    // table's fixed columns, and visible/label feed back into the rules.
    const rules = pivotSvc.sanitizeAll({ [key]: cfg.rules || prev?.config?.rules })[key];
    const cols = sanitizeColumns(cfg.columns, { fixedKeys: (builtin.columns || []).map(c => c.key) });
    if (cols.length) {
      const hidden = cols.filter(c => !c.visible).map(c => c.key);
      if ('hidden_columns' in rules) {
        const wasNull = rules.hidden_columns === null;
        rules.hidden_columns = (wasNull && !hidden.length) ? null : hidden;
      }
      const defLabel = Object.fromEntries((builtin.columns || []).map(c => [c.key, c.label]));
      rules.column_labels = Object.fromEntries(
        cols.filter(c => c.label && c.label !== defLabel[c.key]).map(c => [c.key, c.label]));
    }
    return { ...base, config: { kind: 'pivot', source: 'all', groupBy: rules.group_by || null,
      excludeStatuses: [], columns: cols.length ? cols : pivotColumns(builtin, rules), rules } };
  }
  const source = ['all', ...SOURCES.map(s => s.key)].includes(cfg.source) ? cfg.source : 'all';
  return { ...base, config: {
    kind: 'rows', source,
    groupBy: FIELD_KEYS.has(cfg.groupBy) ? cfg.groupBy : null,
    excludeStatuses: strList(cfg.excludeStatuses),
    columns: sanitizeColumns(cfg.columns),
  } };
}

function sanitizeOptions(o = {}) {
  const dims = (v) => strList(v).filter(k => FIELD_KEYS.has(k) && !HIGH_CARDINALITY.has(k));
  const rowFields = dims(o.row_fields);
  const fields = rowFields.length ? rowFields : DEFAULT_OPTIONS.row_fields;
  const values = strList(o.value_options).filter(v => ['count', 'pct', 'rowpct'].includes(v));
  const pickIn = (v, d) => (fields.includes(v) ? v : (fields.includes(d) ? d : fields[0]));
  return {
    allow_pivot: o.allow_pivot !== false,
    row_fields: fields,
    value_options: values.length ? values : DEFAULT_OPTIONS.value_options,
    default_rows: pickIn(o.default_rows, DEFAULT_OPTIONS.default_rows),
    default_cols: o.default_cols === '' || o.default_cols == null ? ''
      : pickIn(o.default_cols, DEFAULT_OPTIONS.default_cols),
  };
}

// ── persistence ────────────────────────────────────────────────────────────
// First read creates the rows: built-in tables are seeded from the legacy
// weekly_pivot_config row when one exists, so saved settings carry over.
async function seedIfEmpty() {
  const { rows } = await db.query('SELECT COUNT(*)::int AS n FROM weekly_report_tables');
  if (rows[0].n > 0) return;
  let legacy = null;
  try {
    const r = await db.query('SELECT config FROM weekly_pivot_config WHERE id = 1');
    legacy = r.rows[0]?.config?.tables || null;
  } catch { /* legacy table absent */ }
  for (const b of builtinRows()) {
    const t = legacy?.[b.table_key]
      ? sanitizeTable({ ...b, config: { ...b.config, rules: legacy[b.table_key] } })
      : b;
    await db.query(
      `INSERT INTO weekly_report_tables (table_key, title, enabled, sort_order, config)
       VALUES ($1,$2,$3,$4,$5) ON CONFLICT (table_key) DO NOTHING`,
      [t.table_key, t.title, t.enabled, t.sort_order, JSON.stringify(t.config)]);
  }
  await db.query(
    `INSERT INTO weekly_report_pivot_options (id) VALUES (1) ON CONFLICT (id) DO NOTHING`);
}

async function listTables() {
  await seedIfEmpty();
  const { rows } = await db.query('SELECT * FROM weekly_report_tables ORDER BY sort_order, id');
  return rows;
}

async function getOptions() {
  await seedIfEmpty();
  const { rows } = await db.query('SELECT * FROM weekly_report_pivot_options WHERE id = 1');
  return sanitizeOptions(rows[0] || DEFAULT_OPTIONS);
}

async function getAll() {
  const [tables, options] = [await listTables(), await getOptions()];
  return { tables, options, meta: getMeta() };
}

function getMeta() {
  return {
    sources: [{ key: 'all', label: 'All inventories' }, ...SOURCES.map(({ key, label }) => ({ key, label }))],
    fields: FIELDS, formats: FORMATS, limits: LIMITS,
    pivot_fields: FIELDS.filter(f => !HIGH_CARDINALITY.has(f.key)),
    builtin: pivotSvc.getMeta().tables,
    defaults: pivotSvc.getMeta().defaults,
    sources_meta: pivotSvc.getMeta().sources,
  };
}

async function saveAll({ tables, options }, userId) {
  if (!Array.isArray(tables)) throw Object.assign(new Error('tables array is required'), { status: 400 });
  if (tables.length > LIMITS.tables) {
    throw Object.assign(new Error(`At most ${LIMITS.tables} tables`), { status: 400 });
  }
  const existing = Object.fromEntries((await listTables()).map(r => [r.table_key, r]));
  const clean = [];
  for (const [i, t] of tables.entries()) {
    try { clean.push({ ...sanitizeTable({ ...t, sort_order: i + 1 }, existing[t?.table_key]) }); }
    catch (e) { throw Object.assign(e, { status: 400 }); }
  }
  const keys = clean.map(t => t.table_key);
  if (new Set(keys).size !== keys.length) throw Object.assign(new Error('Duplicate table keys'), { status: 400 });
  // Built-in tables cannot be deleted — put back any that were left out.
  const missing = pivotSvc.TABLE_KEYS.filter(k => !keys.includes(k));
  if (missing.length) throw Object.assign(new Error(`Built-in tables cannot be removed: ${missing.join(', ')}`), { status: 400 });

  const client = await db.getClient?.();
  const run = client ? client.query.bind(client) : db.query.bind(db);
  try {
    if (client) await run('BEGIN');
    await run('DELETE FROM weekly_report_tables WHERE NOT (table_key = ANY($1::text[]))', [keys]);
    for (const t of clean) {
      await run(
        `INSERT INTO weekly_report_tables (table_key, title, enabled, sort_order, config, updated_by, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,NOW())
         ON CONFLICT (table_key) DO UPDATE SET title = EXCLUDED.title, enabled = EXCLUDED.enabled,
           sort_order = EXCLUDED.sort_order, config = EXCLUDED.config,
           updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
        [t.table_key, t.title, t.enabled, t.sort_order, JSON.stringify(t.config), userId || null]);
    }
    const o = sanitizeOptions(options);
    await run(
      `INSERT INTO weekly_report_pivot_options (id, allow_pivot, row_fields, value_options, default_rows, default_cols, updated_by, updated_at)
       VALUES (1,$1,$2,$3,$4,$5,$6,NOW())
       ON CONFLICT (id) DO UPDATE SET allow_pivot = EXCLUDED.allow_pivot, row_fields = EXCLUDED.row_fields,
         value_options = EXCLUDED.value_options, default_rows = EXCLUDED.default_rows,
         default_cols = EXCLUDED.default_cols, updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
      [o.allow_pivot, o.row_fields, o.value_options, o.default_rows, o.default_cols, userId || null]);
    if (client) await run('COMMIT');
  } catch (e) {
    if (client) await run('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client?.release();
  }
  return getAll();
}

// Engine view: { tables: { <builtin key>: rules } } — what the report builders
// have always consumed. Also exposes enabled/order so the Report tab can follow.
async function getEngineConfig() {
  const rows = await listTables();
  const tables = {};
  const layout = {};
  for (const r of rows) {
    layout[r.table_key] = { enabled: r.enabled, order: r.sort_order, title: r.title, kind: r.config?.kind };
    if (r.config?.kind === 'pivot' && r.config.rules) tables[r.table_key] = r.config.rules;
  }
  return { tables, layout };
}

// ── flat rows (pivot data, detail tables, export) ──────────────────────────
function unionSql({ source, fields, includeDecom }) {
  const srcs = SOURCES.filter(s => source === 'all' || !source || s.key === source);
  const parts = srcs.map(s => {
    const physical = s.key === 'physical_esxi_servers';
    const cols = fields.map(f => {
      if (f === 'source') return `'${s.label.replace(/'/g, "''")}'::text AS "source"`;
      if (physical && PHYSICAL_NULL.has(f)) return `NULL::text AS "${f}"`;
      return `${f}::text AS "${f}"`;
    });
    // server_status is always carried so exclusions can be applied below.
    const extra = fields.includes('server_status') ? '' : ', server_status::text AS "__status"';
    const decom = includeDecom ? '' : " AND decommissioned_at IS NULL AND COALESCE(server_status,'') NOT ILIKE 'Decom%'";
    return `SELECT ${cols.join(', ')}${extra} FROM ${s.table} WHERE deleted_at IS NULL${decom}`;
  });
  return parts.join(' UNION ALL ');
}

// filters: [{ field, values[] }] — AND between fields, OR within a field's
// values; '(blank)' matches empty. Field keys are whitelisted before use.
function cleanFilters(filters) {
  return (Array.isArray(filters) ? filters : [])
    .filter(f => f && FIELD_KEYS.has(f.field))
    .map(f => ({ field: f.field, values: strList(f.values, 200) }))
    .filter(f => f.values.length)
    .slice(0, 10);
}

async function fetchRows({ source = 'all', fields, excludeStatuses = [], includeDecom = false, limit = 20000, filters = [] }) {
  const fl = cleanFilters(filters);
  const safe = [...new Set([...fields, ...fl.map(f => f.field)])].filter(f => FIELD_KEYS.has(f));
  if (!safe.length) return [];
  const statusCol = safe.includes('server_status') ? '"server_status"' : '"__status"';
  const excl = [...new Set([...ALWAYS_EXCLUDED, ...strList(excludeStatuses).map(s => s.toLowerCase())])];
  const params = [excl];
  const where = [`LOWER(TRIM(COALESCE(${statusCol}, ''))) <> ALL($1::text[])`];
  for (const f of fl) {
    params.push(f.values);
    where.push(`COALESCE(NULLIF(TRIM("${f.field}"), ''), '(blank)') = ANY($${params.length}::text[])`);
  }
  const sql = `SELECT * FROM (${unionSql({ source, fields: safe, includeDecom })}) u
                WHERE ${where.join(' AND ')}
                ORDER BY 1 LIMIT ${Math.min(Math.max(Number(limit) || 0, 1), 50000)}`;
  const { rows } = await db.query(sql, params);
  return rows.map(r => { delete r.__status; return r; });
}

function visibleColumns(cfg) {
  return sanitizeColumns(cfg.columns).filter(c => c.visible);
}

async function getDetailTables() {
  const out = [];
  for (const r of await listTables()) {
    if (!r.enabled || r.config?.kind !== 'rows') continue;
    const columns = visibleColumns(r.config);
    if (!columns.length) continue;
    const rows = await fetchRows({
      source: r.config.source, fields: columns.map(c => c.key), excludeStatuses: r.config.excludeStatuses,
    });
    out.push({ key: r.table_key, title: r.title, columns, groupBy: r.config.groupBy, rows });
  }
  return out;
}

// Draft detail tables (unsaved) → first rows, for the settings preview.
async function previewDetail(draftTables) {
  const out = [];
  for (const raw of (Array.isArray(draftTables) ? draftTables : []).slice(0, LIMITS.tables)) {
    if (raw?.config?.kind !== 'rows') continue;
    let t; try { t = sanitizeTable(raw); } catch { continue; }
    const columns = visibleColumns(t.config);
    if (!columns.length) { out.push({ key: t.table_key, title: t.title, columns, rows: [] }); continue; }
    const rows = await fetchRows({ source: t.config.source, fields: columns.map(c => c.key),
      excludeStatuses: t.config.excludeStatuses, limit: 25 });
    out.push({ key: t.table_key, title: t.title, columns, rows });
  }
  return out;
}

async function getPivotData(includeDecom) {
  const opts = await getOptions();
  if (!opts.allow_pivot) return { options: opts, rows: [] };
  const rows = await fetchRows({ fields: opts.row_fields, includeDecom });
  return { options: opts, rows };
}

// ── CSV / XLSX export ──────────────────────────────────────────────────────
const csvCell = (v) => {
  let s = v == null ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;          // neutralise spreadsheet formulas
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

// Percentage columns picked by the user; only values that exist as pivot columns count.
function cleanPct(p, colVals) {
  const keep = (v) => (Array.isArray(v) ? v : []).map(String).filter(c => !colVals || colVals.includes(c));
  const num = keep(p?.num); const den = keep(p?.den);
  return num.length && den.length ? { num, den } : null;
}

function pivotGrid(rows, rowKey, colKey) {
  const grid = {}; const rowTot = {}; const colTot = {}; let grand = 0;
  for (const r of rows) {
    const a = r[rowKey] || '(blank)';
    const b = colKey ? (r[colKey] || '(blank)') : 'Assets';
    grid[`${a}||${b}`] = (grid[`${a}||${b}`] || 0) + 1;
    rowTot[a] = (rowTot[a] || 0) + 1; colTot[b] = (colTot[b] || 0) + 1; grand++;
  }
  const rowVals = Object.keys(rowTot).sort((x, y) => rowTot[y] - rowTot[x]);
  const colVals = Object.keys(colTot).sort();
  return { grid, rowTot, colTot, grand, rowVals, colVals };
}

// Sheets: [{ name, header: string[], rows: any[][] }]
async function buildExportSheets({ pivot }) {
  const sheets = [];
  for (const t of await getDetailTables()) {
    sheets.push({
      name: t.title,
      header: t.columns.map(c => c.label || FIELDS.find(f => f.key === c.key)?.label || c.key),
      rows: t.rows.map(r => t.columns.map(c => r[c.key])),
    });
  }
  if (pivot) {
    const opts = await getOptions();
    if (opts.allow_pivot && opts.row_fields.includes(pivot.rows)
        && (!pivot.cols || (opts.row_fields.includes(pivot.cols) && pivot.cols !== pivot.rows))) {
      const filters = cleanFilters(pivot.filters).filter(f => opts.row_fields.includes(f.field));
      const data = await fetchRows({ fields: [pivot.rows, ...(pivot.cols ? [pivot.cols] : [])], includeDecom: !!pivot.includeDecom, filters });
      const g = pivotGrid(data, pivot.rows, pivot.cols || null);
      const label = (k) => FIELDS.find(f => f.key === k)?.label || k;
      const val = (n, base) => (pivot.value === 'pct' ? `${((n / (g.grand || 1)) * 100).toFixed(1)}%`
        : pivot.value === 'rowpct' ? `${((n / (base || 1)) * 100).toFixed(1)}%` : n);
      // Optional percentage column: (sum of num columns) / (sum of den columns).
      const pc = cleanPct(pivot.pct, g.colVals);
      const pctOf = (cells) => {
        const sum = (cols) => cols.reduce((t, c) => t + (cells[c] || 0), 0);
        const d = sum(pc.den);
        return d ? `${((sum(pc.num) / d) * 100).toFixed(2)}%` : '';
      };
      sheets.push({
        name: `Pivot ${label(pivot.rows)}${pivot.cols ? ` x ${label(pivot.cols)}` : ''}`,
        header: [label(pivot.rows), ...g.colVals, 'Total', ...(pc && pivot.cols ? ['Percentage'] : [])],
        rows: [
          ...g.rowVals.map(a => [a, ...g.colVals.map(b => val(g.grid[`${a}||${b}`] || 0, g.rowTot[a])), g.rowTot[a],
            ...(pc && pivot.cols ? [pctOf(Object.fromEntries(g.colVals.map(b => [b, g.grid[`${a}||${b}`] || 0])))] : [])]),
          ['Total', ...g.colVals.map(b => g.colTot[b]), g.grand, ...(pc && pivot.cols ? [pctOf(g.colTot)] : [])],
        ],
      });
    }
  }
  return sheets;
}

async function exportCsv(args) {
  const sheets = await buildExportSheets(args);
  return sheets.map(s => `${csvCell(s.name)}\n${[s.header, ...s.rows].map(r => r.map(csvCell).join(',')).join('\n')}`)
    .join('\n\n') + '\n';
}

async function exportXlsx(args) {
  const ExcelJS = require('exceljs');
  const wb = new ExcelJS.Workbook();
  const used = new Set();
  for (const s of await buildExportSheets(args)) {
    let name = s.name.replace(/[\\/*?:[\]]/g, ' ').slice(0, 28) || 'Sheet';
    for (let i = 2; used.has(name.toLowerCase()); i++) name = `${name.slice(0, 25)} ${i}`;
    used.add(name.toLowerCase());
    const ws = wb.addWorksheet(name);
    ws.addRow(s.header).font = { bold: true };
    s.rows.forEach(r => ws.addRow(r.map(v => (typeof v === 'string' && /^[=+\-@]/.test(v) ? `'${v}` : v))));
    ws.columns.forEach(c => { c.width = 20; });
  }
  if (!wb.worksheets.length) wb.addWorksheet('Empty');
  return wb.xlsx.writeBuffer();
}

// ── personal views ─────────────────────────────────────────────────────────
const cleanView = (v = {}) => ({
  rows: FIELD_KEYS.has(v.rows) ? v.rows : null,
  cols: FIELD_KEYS.has(v.cols) ? v.cols : null,
  value: ['count', 'pct', 'rowpct'].includes(v.value) ? v.value : 'count',
  includeDecom: !!v.includeDecom,
  filters: cleanFilters(v.filters),
  pct: cleanPct(v.pct, null) || { num: [], den: [] },
});
const listViews = async (userId) =>
  (await db.query('SELECT id, name, view_config FROM weekly_report_views WHERE user_id = $1 ORDER BY name', [userId])).rows;
async function saveView(userId, name, view) {
  const n = str(name, 80);
  if (!n) throw Object.assign(new Error('Name is required'), { status: 400 });
  const { rows } = await db.query(
    `INSERT INTO weekly_report_views (user_id, name, view_config) VALUES ($1,$2,$3)
     ON CONFLICT (user_id, name) DO UPDATE SET view_config = EXCLUDED.view_config
     RETURNING id, name, view_config`, [userId, n, JSON.stringify(cleanView(view))]);
  return rows[0];
}
const deleteView = async (userId, id) =>
  (await db.query('DELETE FROM weekly_report_views WHERE id = $1 AND user_id = $2', [Number(id) || 0, userId])).rowCount > 0;

module.exports = {
  getAll, getMeta, saveAll, getEngineConfig, getOptions,
  getDetailTables, previewDetail, getPivotData, exportCsv, exportXlsx,
  listViews, saveView, deleteView,
};
