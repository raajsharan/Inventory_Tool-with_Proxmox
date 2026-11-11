/**
 * weeklyPivotConfigService.js
 * ---------------------------
 * Admin-editable configuration for the tables on the Weekly Report's
 * "Report" tab, plus the SQL builder for the config-driven ("filtered")
 * pivot engine.
 *
 * Adding a table later: add an entry to TABLE_REGISTRY (metadata the settings
 * tab renders generically) and to DEFAULTS (its starting values), then read
 * getConfig().tables.<key> where that table is built. The settings tab needs
 * no change — it is drawn from TABLE_REGISTRY.
 *
 * Stored in its own row (weekly_pivot_config) so it can never clobber
 * compliance_config. A stored value of null / missing means "use the
 * default", so defaults can improve without migrating saved settings.
 */
const db = require('../config/db');

const SOURCES = [
  { key: 'assets',                label: 'Assets',            table: 'assets' },
  { key: 'beijing_assets',        label: 'Beijing Assets',    table: 'beijing_assets' },
  { key: 'ext_assets',            label: 'Ext. Assets',       table: 'ext_assets' },
  { key: 'physical_esxi_servers', label: 'Physical & ESXi',   table: 'physical_esxi_servers' },
];
const SOURCE_KEYS = SOURCES.map(s => s.key);

// Whitelist — group_by is interpolated into SQL, never taken from input as-is.
const GROUP_FIELDS = [
  { key: 'location',      label: 'Location' },
  { key: 'department',    label: 'Department' },
  { key: 'os_type',       label: 'OS Type' },
  { key: 'asset_type',    label: 'Asset Type' },
  { key: 'server_status', label: 'Server Status' },
  { key: 'patching_type', label: 'Patching Type' },
  { key: 'eol_status',    label: 'EOL Status' },
];
const GROUP_KEYS = GROUP_FIELDS.map(g => g.key);
// physical_esxi_servers has no patching/EOL columns.
const PHYSICAL_NULL_FIELDS = new Set(['patching_type', 'eol_status']);

const PATCHING_METRICS = [
  { key: 'auto_patching',   label: 'Auto' },
  { key: 'eol',             label: 'EOL - No Patches' },
  { key: 'exception',       label: 'Exception' },
  { key: 'manual_patching', label: 'Manual' },
  { key: 'on_hold',         label: 'On Hold' },
  { key: 'onboard_pending', label: 'Onboard Pending' },
];
const METRIC_KEYS = PATCHING_METRICS.map(m => m.key);

const ME_COLUMNS = [
  { key: 'bucket', label: 'Patching Type' },
  { key: 'no_me',  label: 'No' },
  { key: 'yes_me', label: 'Yes' },
  { key: 'total',  label: 'Total' },
];
const NESSUS_COLUMNS = [
  { key: 'mslAssets',     label: 'Assets Inventory' },
  { key: 'extAssets',     label: 'Ext. Inventory' },
  { key: 'beijingAssets', label: 'Beijing Inventory' },
  { key: 'physicalEsxi',  label: 'Physical & ESXi Inventory' },
  { key: 'count',         label: 'Total Count' },
];
const ME_BUCKETS = [
  'Alive But Powered Off', 'Auto', 'Beijing IT Team', 'EOL - No Patches', 'Exception',
  'Manual', 'Not Applicable', 'On Hold', 'Onboard Pending', 'Other',
];

const NA_PATTERNS = ['Not Applicable%', 'NA', 'N/A'];

const emptySource = () => ({
  enabled: false, status_include: [], os_include: [], os_exclude: [],
  patching_na: [], patching_exclude: [], exclude_eol: false, location_exclude: [],
});

// Rules that reproduce the Location-wise patching table as it ships today.
function locationPatchingSources() {
  return {
    beijing_assets: {
      ...emptySource(), enabled: true, status_include: ['Alive'],
      os_include: ['windows', 'linux'], patching_na: [...NA_PATTERNS],
    },
    assets: {
      ...emptySource(), enabled: true, status_include: ['Alive'],
      os_exclude: ['appliance', 'cisco', 'mac', 'storage', 'esxi', 'proxmox'],
      patching_na: [...NA_PATTERNS],
      patching_exclude: ['EOL%', '%power%off%', 'Exception%'], exclude_eol: true,
    },
    ext_assets: {
      ...emptySource(), enabled: true, status_include: ['Alive'],
      os_exclude: ['esxi', 'appliance'], location_exclude: ['beijing'],
      patching_na: [...NA_PATTERNS], patching_exclude: ['EOL%', 'Exception%'], exclude_eol: true,
    },
    physical_esxi_servers: emptySource(),
  };
}

const DEFAULTS = {
  location_patching: {
    title: 'Location wise auto/Manual-patching status:',
    hint: '',                      // '' = auto-generated hint
    group_by: 'location',
    mode: 'filtered',              // 'filtered' = row filters below | 'legacy' = built-in rules
    sources: locationPatchingSources(),
    hidden_columns: null,          // null = fall back to Compliance Config
    column_labels: {},
    pct: {
      mode: 'formula',
      num: ['auto_patching', 'manual_patching'],
      den: ['auto_patching', 'manual_patching', 'onboard_pending', 'on_hold'],
      exclude: null,
    },
    excluded_groups: null,         // null = fall back to Compliance Config
  },
  department_patching: {
    title: 'Departments Patching Onboarding Status:',
    hint: '',
    group_by: 'department',
    mode: 'legacy',
    sources: locationPatchingSources(),
    hidden_columns: null,
    column_labels: {},
    pct: { mode: 'exclude', num: ['auto_patching', 'manual_patching'], den: ['auto_patching', 'manual_patching', 'onboard_pending', 'on_hold'], exclude: null },
    excluded_groups: null,
  },
  location_count: {
    title: 'Location-wise endpoint count:',
    group_by: 'location',
    mode: 'legacy',
    sources: {
      assets:                { ...emptySource(), enabled: true },
      beijing_assets:        { ...emptySource(), enabled: true, os_include: [] },
      ext_assets:            { ...emptySource(), enabled: true },
      physical_esxi_servers: { ...emptySource(), enabled: true },
    },
    group_label: 'Location',
    count_label: 'Count',
    excluded_groups: [],
  },
  me_compliance: {
    title: 'Auto Patching Group Count Status',
    footnote: '',                  // '' = Compliance Config / built-in footnote
    msl_exclude_buckets: null,
    ext_exclude_buckets: null,
    hidden_columns: [],
    column_labels: {},
  },
  nessus: {
    title: 'Nessus Agent Install',
    os_windows: ['windows'],
    os_linux: ['linux', 'ubuntu', 'centos', 'rhel', 'red hat', 'redhat', 'debian', 'suse', 'fedora',
      'rocky', 'alma', 'oracle linux', 'amazon linux'],
    os_not_applicable: ['centos', 'proxmox', 'vcenter', 'vmware', 'esxi', 'appliance', 'cisco', 'mac', 'eveng'],
    hidden_columns: [],
    column_labels: {},
  },
};

// What the settings tab renders for each table. `supports` flags decide which
// editor sections appear, so a new table only needs an entry here.
const TABLE_REGISTRY = [
  {
    key: 'location_patching', title: 'Location-wise Auto/Manual patching status',
    description: 'Patching pivot grouped by a field (location by default). Row filters decide which assets count.',
    supports: { title: true, hint: true, group_by: true, mode: true, filters: true, columns: true, pct: true, excluded_groups: true },
    columns: PATCHING_METRICS, group_fields: GROUP_FIELDS,
  },
  {
    key: 'department_patching', title: 'Departments Patching Onboarding Status',
    description: 'Same pivot grouped by department. "Legacy" keeps the built-in rules; switch to "Filtered" to use row filters.',
    supports: { title: true, hint: true, group_by: true, mode: true, filters: true, columns: true, pct: true, excluded_groups: true },
    columns: PATCHING_METRICS, group_fields: GROUP_FIELDS,
  },
  {
    key: 'location_count', title: 'Location-wise endpoint count (Assets Inventory)',
    description: 'Endpoint count grouped by a field. "Legacy" keeps the built-in Assets + Ext. + Beijing rules.',
    supports: { title: true, group_by: true, mode: true, filters: true, labels: true, excluded_groups: true },
    columns: [], group_fields: GROUP_FIELDS,
  },
  {
    key: 'me_compliance', title: 'ManageEngine group count (Patch Management)',
    description: 'Auto Patching Group Count table and the ManageEngine compliance percentage.',
    supports: { title: true, footnote: true, buckets: true, columns: true },
    columns: ME_COLUMNS, buckets: ME_BUCKETS,
  },
  {
    key: 'nessus', title: 'Nessus Agent Install',
    description: 'Applicable / Not Applicable split. OS patterns are matched as "contains" text, case-insensitive.',
    supports: { title: true, os_lists: true, columns: true },
    columns: NESSUS_COLUMNS,
  },
];
const TABLE_KEYS = TABLE_REGISTRY.map(t => t.key);

// ── sanitizing ────────────────────────────────────────────────────────────
const strList = (v, max = 100) => (Array.isArray(v) ? v : [])
  .map(x => String(x ?? '').trim()).filter(x => x && x.length <= 120).slice(0, max)
  .filter((x, i, a) => a.indexOf(x) === i);
const str = (v, max = 200) => String(v ?? '').trim().slice(0, max);
const pick = (v, allowed, fallback) => (allowed.includes(v) ? v : fallback);
const metricList = (v) => strList(v).filter(k => METRIC_KEYS.includes(k));

function sanitizeLabels(v, allowedKeys) {
  const out = {};
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    for (const k of allowedKeys) {
      const s = str(v[k], 80);
      if (s) out[k] = s;
    }
  }
  return out;
}

function sanitizeSources(v) {
  const out = {};
  for (const k of SOURCE_KEYS) {
    const s = (v && v[k]) || {};
    out[k] = {
      enabled: !!s.enabled,
      status_include: strList(s.status_include),
      os_include: strList(s.os_include),
      os_exclude: strList(s.os_exclude),
      patching_na: strList(s.patching_na),
      patching_exclude: strList(s.patching_exclude),
      exclude_eol: !!s.exclude_eol,
      location_exclude: strList(s.location_exclude),
    };
  }
  return out;
}

function sanitizeTable(key, t = {}) {
  const d = DEFAULTS[key];
  const nullableList = (v, list) => (v === null || v === undefined ? null : list(v));
  switch (key) {
    case 'location_patching':
    case 'department_patching': {
      const mode = pick(t.mode, ['filtered', 'legacy'], d.mode);
      let groupBy = pick(t.group_by, GROUP_KEYS, d.group_by);
      // The legacy query only carries location and department.
      if (mode === 'legacy' && !['location', 'department'].includes(groupBy)) groupBy = d.group_by;
      const pm = pick(t.pct?.mode, ['formula', 'exclude'], d.pct.mode);
      return {
        title: str(t.title) || d.title,
        hint: str(t.hint, 600),
        group_by: groupBy,
        mode,
        sources: sanitizeSources(t.sources),
        hidden_columns: nullableList(t.hidden_columns, metricList),
        column_labels: sanitizeLabels(t.column_labels, METRIC_KEYS),
        pct: {
          mode: pm,
          num: metricList(t.pct?.num),
          den: metricList(t.pct?.den),
          exclude: nullableList(t.pct?.exclude, metricList),
        },
        excluded_groups: nullableList(t.excluded_groups, (x) => strList(x, 200)),
      };
    }
    case 'location_count': {
      const mode = pick(t.mode, ['filtered', 'legacy'], d.mode);
      let groupBy = pick(t.group_by, GROUP_KEYS, d.group_by);
      if (mode === 'legacy') groupBy = 'location';
      return {
        title: str(t.title) || d.title,
        group_by: groupBy,
        mode,
        sources: sanitizeSources(t.sources),
        group_label: str(t.group_label, 60) || d.group_label,
        count_label: str(t.count_label, 60) || d.count_label,
        excluded_groups: strList(t.excluded_groups, 200),
      };
    }
    case 'me_compliance':
      return {
        title: str(t.title) || d.title,
        footnote: str(t.footnote, 600),
        msl_exclude_buckets: nullableList(t.msl_exclude_buckets, (x) => strList(x).filter(b => ME_BUCKETS.includes(b))),
        ext_exclude_buckets: nullableList(t.ext_exclude_buckets, (x) => strList(x).filter(b => ME_BUCKETS.includes(b))),
        hidden_columns: strList(t.hidden_columns).filter(k => ME_COLUMNS.some(c => c.key === k)),
        column_labels: sanitizeLabels(t.column_labels, ME_COLUMNS.map(c => c.key)),
      };
    case 'nessus':
      return {
        title: str(t.title) || d.title,
        os_windows: strList(t.os_windows).length ? strList(t.os_windows) : d.os_windows,
        os_linux: strList(t.os_linux).length ? strList(t.os_linux) : d.os_linux,
        os_not_applicable: strList(t.os_not_applicable),
        hidden_columns: strList(t.hidden_columns).filter(k => NESSUS_COLUMNS.some(c => c.key === k)),
        column_labels: sanitizeLabels(t.column_labels, NESSUS_COLUMNS.map(c => c.key)),
      };
    default:
      return d;
  }
}

function sanitizeAll(tables = {}) {
  const out = {};
  for (const k of TABLE_KEYS) out[k] = sanitizeTable(k, tables[k] || DEFAULTS[k]);
  return out;
}

// ── persistence ───────────────────────────────────────────────────────────
function mergeWithDefaults(stored) {
  const out = {};
  for (const k of TABLE_KEYS) {
    const s = stored?.[k];
    out[k] = s && typeof s === 'object' ? sanitizeTable(k, s) : JSON.parse(JSON.stringify(DEFAULTS[k]));
  }
  return out;
}

async function getConfig() {
  try {
    const { rows } = await db.query('SELECT config FROM weekly_pivot_config WHERE id = 1');
    return { tables: mergeWithDefaults(rows[0]?.config?.tables) };
  } catch {
    return { tables: mergeWithDefaults(null) };   // table not created yet → defaults
  }
}

async function saveConfig(input, userId) {
  const tables = sanitizeAll(input?.tables || {});
  await db.query(
    `INSERT INTO weekly_pivot_config (id, config, updated_by, updated_at)
     VALUES (1, $1, $2, NOW())
     ON CONFLICT (id) DO UPDATE
       SET config = EXCLUDED.config, updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
    [JSON.stringify({ tables }), userId || null],
  );
  return { tables };
}

function getMeta() {
  return {
    tables: TABLE_REGISTRY, sources: SOURCES, defaults: DEFAULTS,
    group_fields: GROUP_FIELDS, metrics: PATCHING_METRICS,
  };
}

// ── config-driven pivot SQL ───────────────────────────────────────────────
// One SELECT per enabled source, each tagging rows with:
//   in_total  — passes every rule of that source (status, OS, location,
//               Not-Applicable, excluded patching)
//   is_eol / is_exc / is_hold / is_onb — informational flags for assets the
//               rules leave out (they pass the OS/location/N-A rules only)
function buildFlaggedCte(tc) {
  const params = [];
  const p = (v) => { params.push(v); return `$${params.length}`; };
  const ilikeAny = (col, arr) => `${col} ILIKE ANY(${p(arr)}::text[])`;

  const selects = [];
  for (const src of SOURCES) {
    const c = tc.sources?.[src.key];
    if (!c || !c.enabled) continue;
    const physical = src.key === 'physical_esxi_servers';
    const g = GROUP_KEYS.includes(tc.group_by) ? tc.group_by : 'location';
    const grpExpr = physical && PHYSICAL_NULL_FIELDS.has(g) ? 'NULL::text' : g;
    const patching = physical ? 'NULL::text' : 'patching_type';
    const eol = physical ? 'NULL::text' : 'eol_status';

    const osParts = [];
    if (c.os_include.length) osParts.push(ilikeAny("COALESCE(os_type,'')", c.os_include.map(x => `%${x}%`)));
    if (c.os_exclude.length) osParts.push(`NOT (${ilikeAny("COALESCE(os_type,'')", c.os_exclude.map(x => `%${x}%`))})`);
    if (c.location_exclude.length) osParts.push(`NOT (${ilikeAny("COALESCE(location,'')", c.location_exclude.map(x => `%${x}%`))})`);
    const osOk = osParts.length ? osParts.join(' AND ') : 'TRUE';

    const na = c.patching_na.length && !physical ? ilikeAny("COALESCE(patching_type,'')", c.patching_na) : 'FALSE';

    const exclParts = [];
    if (c.patching_exclude.length && !physical) exclParts.push(ilikeAny("COALESCE(patching_type,'')", c.patching_exclude));
    if (c.exclude_eol && !physical) exclParts.push("COALESCE(eol_status,'') = 'EOL'");
    const ruleExcl = exclParts.length ? `(${exclParts.join(' OR ')})` : 'FALSE';

    const statusOk = c.status_include.length
      ? `LOWER(TRIM(COALESCE(server_status,''))) = ANY(${p(c.status_include.map(x => x.toLowerCase()))}::text[])`
      : 'TRUE';

    selects.push(`
        SELECT ${grpExpr} AS grp, ${patching} AS patching_type, ${eol} AS eol_status, server_status,
               (${osOk}) AS os_ok, (${na}) AS na, ${ruleExcl} AS rule_excl, (${statusOk}) AS status_ok
          FROM ${src.table}
         WHERE deleted_at IS NULL AND decommissioned_at IS NULL
           AND COALESCE(server_status,'') NOT ILIKE 'Decom%'`);
  }
  if (!selects.length) return null;

  const sql = `
      WITH base AS (${selects.join('\n        UNION ALL')}
      ),
      flagged AS (
        SELECT *,
               (status_ok AND os_ok AND NOT na AND NOT rule_excl) AS in_total,
               (os_ok AND NOT na AND (COALESCE(patching_type,'') ILIKE 'EOL%' OR COALESCE(eol_status,'') = 'EOL')) AS is_eol,
               (os_ok AND NOT na AND COALESCE(patching_type,'') ILIKE 'Exception%'
                AND NOT (COALESCE(patching_type,'') ILIKE 'EOL%' OR COALESCE(eol_status,'') = 'EOL')) AS is_exc,
               (os_ok AND NOT na
                AND (COALESCE(server_status,'') ILIKE 'Onboard%' OR COALESCE(server_status,'') ILIKE 'Pending%'
                     OR COALESCE(patching_type,'') ILIKE 'Onboard%')
                AND NOT (COALESCE(patching_type,'') ILIKE 'EOL%' OR COALESCE(eol_status,'') = 'EOL')
                AND NOT COALESCE(patching_type,'') ILIKE 'Exception%'
                AND NOT COALESCE(server_status,'') ILIKE 'On Hold%') AS is_onb,
               (os_ok AND NOT na AND COALESCE(server_status,'') ILIKE 'On Hold%'
                AND NOT (COALESCE(patching_type,'') ILIKE 'EOL%' OR COALESCE(eol_status,'') = 'EOL')
                AND NOT COALESCE(patching_type,'') ILIKE 'Exception%') AS is_hold
          FROM base
      )`;
  return { sql, params };
}

// Rows shaped like buildWeeklyBreakdown(): bucket + metric columns + total.
// Total is the sum of the metric columns so a row always adds up.
function buildPatchingPivot(tc) {
  const cte = buildFlaggedCte(tc);
  if (!cte) return null;
  return {
    text: `${cte.sql}
      SELECT bucket, auto_patching, manual_patching, eol, exception, onboard_pending, on_hold,
             0 AS alive_powered_off, 0 AS not_applicable,
             (auto_patching + manual_patching + eol + exception + onboard_pending + on_hold)::int AS total
        FROM (
          SELECT COALESCE(NULLIF(TRIM(grp), ''), 'Unassigned') AS bucket,
                 COUNT(*) FILTER (WHERE in_total AND patching_type ILIKE 'Auto%')::int   AS auto_patching,
                 COUNT(*) FILTER (WHERE in_total AND patching_type ILIKE 'Manual%')::int AS manual_patching,
                 COUNT(*) FILTER (WHERE is_eol)::int  AS eol,
                 COUNT(*) FILTER (WHERE is_exc)::int  AS exception,
                 COUNT(*) FILTER (WHERE is_onb)::int  AS onboard_pending,
                 COUNT(*) FILTER (WHERE is_hold)::int AS on_hold
            FROM flagged GROUP BY 1
        ) t
       WHERE auto_patching + manual_patching + eol + exception + onboard_pending + on_hold > 0
       ORDER BY total DESC, bucket`,
    values: cte.params,
  };
}

// Plain count of assets that pass the source rules, grouped.
function buildCountPivot(tc) {
  const cte = buildFlaggedCte(tc);
  if (!cte) return null;
  return {
    text: `${cte.sql}
      SELECT COALESCE(NULLIF(TRIM(grp), ''), 'Unassigned') AS location, COUNT(*)::int AS count
        FROM flagged WHERE in_total
       GROUP BY 1 ORDER BY 2 DESC`,
    values: cte.params,
  };
}

// '%x%' patterns for Nessus OS classification.
const likeContains = (arr) => arr.map(x => `%${x}%`);

module.exports = {
  getConfig, saveConfig, getMeta, sanitizeAll, DEFAULTS, TABLE_KEYS, METRIC_KEYS, PATCHING_METRICS,
  buildPatchingPivot, buildCountPivot, likeContains,
  ME_COLUMNS, NESSUS_COLUMNS,
};
