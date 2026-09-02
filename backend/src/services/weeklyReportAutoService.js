/**
 * weeklyReportAutoService.js
 * ---------------------------
 * Builds every "auto" section of the Weekly Report from data this app
 * already computes elsewhere — reused directly (same process, no HTTP hop)
 * rather than re-deriving fragile, compliance_config-dependent SQL a second
 * time. Each getXSection() returns display-ready, already-computed numbers
 * (percentages etc. resolved now, at build time) so an archived snapshot
 * stays a frozen, self-contained record — a later admin edit to
 * compliance_config must not retroactively change what a past week's report
 * said.
 */
const db = require('../config/db');
const dashboardController = require('../controllers/dashboardController');
const { DEFAULT_CONFIG: COMPLIANCE_DEFAULTS } = require('../controllers/complianceConfigController');
const endpointCentralService = require('./endpointCentralService');
const migrationService = require('./migrationService');

// Calls an Express-style controller function (req, res, next) directly, in
// this same process, and resolves with whatever it passed to res.json(). The
// controller's own try/catch always routes errors through `next`, never a
// rejected promise, so this only needs to race res.json() vs next().
function callController(fn, req = {}) {
  return new Promise((resolve, reject) => {
    const res = { json: (data) => resolve(data) };
    const next = (err) => reject(err || new Error('Unknown controller error'));
    fn(req, res, next);
  });
}

async function getComplianceConfig() {
  try {
    const { rows } = await db.query('SELECT config FROM compliance_config WHERE id = 1');
    return (rows[0]?.config && Object.keys(rows[0].config).length) ? rows[0].config : COMPLIANCE_DEFAULTS;
  } catch {
    return COMPLIANCE_DEFAULTS;
  }
}

const pct = (n, d) => (d ? Math.round((n / d) * 10000) / 100 : 0);

// All possible patching-type columns — mirrors BREAKDOWN_METRICS in
// Dashboard.jsx's WeeklyReportTab. Only columns with at least one non-zero
// value across the rows are kept, same "adapts to the data" behavior.
const BREAKDOWN_METRICS = [
  { key: 'alive_powered_off', title: 'Alive But Powered Off' },
  { key: 'auto_patching',     title: 'Auto' },
  { key: 'beijing_it',        title: 'Beijing IT Team' },
  { key: 'eol',               title: 'EOL - No Patches' },
  { key: 'exception',         title: 'Exception' },
  { key: 'manual_patching',   title: 'Manual' },
  { key: 'on_hold',           title: 'On Hold' },
  { key: 'onboard_pending',   title: 'Onboard Pending' },
];

// Percentage = (Total - out-of-scope types) / Total, using pctExclude — same
// formula as WeeklyBreakdownTable in Dashboard.jsx.
function enrichBreakdownRows(rows, excludedBuckets, pctExclude) {
  const filtered = (rows || []).filter(r => !excludedBuckets.includes(r.bucket));
  const enriched = filtered.map(r => {
    const total = Number(r.total || 0);
    const excluded = pctExclude.reduce((s, k) => s + Number(r[k] || 0), 0);
    const inScope = total - excluded;
    return { ...r, pct: total ? Math.round((inScope / total) * 10000) / 100 : 0 };
  });
  const sumKey = (key) => enriched.reduce((s, r) => s + Number(r[key] || 0), 0);
  const totalSum = sumKey('total');
  const inScopeSum = totalSum - pctExclude.reduce((s, k) => s + sumKey(k), 0);
  const activeMetrics = BREAKDOWN_METRICS.filter(m => sumKey(m.key) > 0);
  return {
    columns: activeMetrics.map(m => m.title),
    rows: enriched.map(r => ({
      bucket: r.bucket,
      values: activeMetrics.map(m => Number(r[m.key] || 0)),
      total: Number(r.total || 0),
      pct: r.pct,
    })),
    totals: {
      values: activeMetrics.map(m => sumKey(m.key)),
      total: totalSum,
      pct: totalSum ? Math.round((inScopeSum / totalSum) * 10000) / 100 : 0,
    },
  };
}

async function getAssetInventorySection(dashboardData) {
  const data = dashboardData || await callController(dashboardController.summary);
  const msl = data.mslCompliance || {};
  const vmGaps = data.weeklyVmGaps || {};
  return {
    section_key: 'asset_inventory',
    title: 'Assets Inventory (MSL + Ext)',
    kind: 'auto',
    data: {
      combinedNumerator: msl.combinedNumerator ?? 0,
      combinedDenominator: msl.combinedDenominator ?? 0,
      combinedPct: pct(msl.combinedNumerator ?? 0, msl.combinedDenominator ?? 0),
      decommissioned: vmGaps.decommissioned ?? 0,
      noPassword: vmGaps.no_password ?? 0,
      noHostedIp: vmGaps.no_hosted_ip ?? 0,
      nameConflicts: vmGaps.name_conflicts ?? 0,
      locations: msl.assetExtLocations || [],
    },
  };
}

async function getNessusSection(dashboardData) {
  const data = dashboardData || await callController(dashboardController.summary);
  const na = data.weeklyNessusApplicability || {};
  const applicable = na.applicable || { total: 0, installed: 0 };
  const notApplicable = na.not_applicable || { total: 0, installed: 0 };
  return {
    section_key: 'nessus_agent',
    title: 'Nessus Agent Install',
    kind: 'auto',
    data: {
      applicable,
      notApplicable,
      total: na.total ?? 0,
      compliancePct: pct(applicable.installed ?? 0, applicable.total ?? 0),
    },
  };
}

async function getPatchManagementSection(dashboardData) {
  const [data, compCfg, agents] = await Promise.all([
    dashboardData ? Promise.resolve(dashboardData) : callController(dashboardController.summary),
    getComplianceConfig(),
    endpointCentralService.fetchAgents().catch(() => []),
  ]);

  const weeklyCfg = compCfg.weekly || COMPLIANCE_DEFAULTS.weekly;
  const mslExcl = weeklyCfg.me_msl_exclude_buckets ?? COMPLIANCE_DEFAULTS.weekly.me_msl_exclude_buckets;
  const extExcl = weeklyCfg.me_ext_exclude_buckets ?? COMPLIANCE_DEFAULTS.weekly.me_ext_exclude_buckets;
  const mslFootnote = weeklyCfg.me_msl_footnote || COMPLIANCE_DEFAULTS.weekly.me_msl_footnote
    || '(*Excludes Bomgar & Beijing Team Managed count, esxi hosts and not applicable vms, powered off VMs EOL VMs)';
  const extFootnote = weeklyCfg.me_ext_footnote || COMPLIANCE_DEFAULTS.weekly.me_ext_footnote
    || "(*Excludes ESXi hosts and not applicable vm's like appliances, Beijing IT managed, exceptions, EOL VMs)";
  const pctExclude = weeklyCfg.breakdown_pct_exclude ?? COMPLIANCE_DEFAULTS.weekly.breakdown_pct_exclude;
  const exclLocs = weeklyCfg.breakdown_excluded_locations ?? [];
  const exclDepts = weeklyCfg.breakdown_excluded_departments ?? [];

  const locationPatching = enrichBreakdownRows(data.weeklyLocationPatching, exclLocs, pctExclude);
  const departmentPatching = enrichBreakdownRows(data.weeklyDepartmentPatching, exclDepts, pctExclude);

  const meMslRows = data.meMslBreakdown || [];
  const meExtRows = data.meExtBreakdown || [];
  const meMslIncl = meMslRows.filter(r => !mslExcl.includes(r.bucket));
  const meExtIncl = meExtRows.filter(r => !extExcl.includes(r.bucket));
  const meMslYes = meMslIncl.reduce((s, r) => s + (r.yes_me || 0), 0);
  // Denominator is the grand-total Yes count across ALL buckets (including
  // excluded ones), not the included-only total — matches Dashboard.jsx.
  const meMslDen = meMslRows.reduce((s, r) => s + (r.yes_me || 0), 0);
  const meExtYes = meExtIncl.reduce((s, r) => s + (r.yes_me || 0), 0);
  const meExtDen = meExtIncl.reduce((s, r) => s + (r.total || 0), 0);
  const combinedYes = meMslYes + meExtYes;
  const combinedDen = meMslDen + meExtDen;

  const mergedMap = new Map();
  for (const r of [...meMslRows, ...meExtRows]) {
    const cur = mergedMap.get(r.bucket) || { bucket: r.bucket, no_me: 0, yes_me: 0, total: 0 };
    cur.no_me += r.no_me || 0;
    cur.yes_me += r.yes_me || 0;
    cur.total += r.total || 0;
    mergedMap.set(r.bucket, cur);
  }

  const managedComputers = agents.filter(a => a.managed_status === 1).length;
  const waitingComputers = agents.filter(a => a.agent_install_status === 21).length;

  return {
    section_key: 'patch_management',
    title: 'Patch Management Solution / ManageEngine Deployment',
    kind: 'auto',
    data: {
      managedComputers,
      waitingComputers,
      totalEndpoints: agents.length,
      locationPatching,
      departmentPatching,
      meCompliance: {
        combinedYes, combinedDen, combinedPct: pct(combinedYes, combinedDen),
        rows: Array.from(mergedMap.values()),
        footnote: `${mslFootnote} ${extFootnote}`,
      },
    },
  };
}

async function getMigrationSection() {
  const projects = await migrationService.getProjects();
  const projectId = projects.find(p => p.is_default)?.id ?? projects[0]?.id ?? null;
  const ov = await migrationService.overview(projectId);
  return {
    section_key: 'migration_project',
    title: 'PROJECT WORK: VMware/Broadcom to Proxmox Migration',
    kind: 'auto',
    data: { projectId, ...ov },
  };
}

async function buildAutoSections() {
  // dashboardController.summary() runs ~25 queries — fetch it exactly once
  // and share it across the three sections that need it, rather than each
  // triggering its own independent, redundant call.
  const dashboardData = await callController(dashboardController.summary);
  const [assetInventory, patchManagement, nessus, migration] = await Promise.all([
    getAssetInventorySection(dashboardData),
    getPatchManagementSection(dashboardData),
    getNessusSection(dashboardData),
    getMigrationSection(),
  ]);
  // Screenshot row order: Asset Inventory, Patch Management, Nessus, then
  // Migration further down alongside the manual sections.
  return { assetInventory, patchManagement, nessus, migration };
}

module.exports = {
  getAssetInventorySection, getNessusSection, getPatchManagementSection, getMigrationSection,
  buildAutoSections,
};
