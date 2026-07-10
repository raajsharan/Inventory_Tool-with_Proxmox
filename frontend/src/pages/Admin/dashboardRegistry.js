/**
 * dashboardRegistry.js — single source of truth for every customizable
 * dashboard element. The Dashboard Settings page renders from this registry
 * and the Dashboard consumes it, so adding a future view/tab/widget here
 * makes it configurable automatically — no settings-page changes needed.
 *
 * Config shape stored in dashboard_config.config (JSONB):
 * {
 *   default_view: 'inventory' | 'infrastructure',
 *   default_tab:  'exec' | 'asset' | 'ext' | 'weekly',
 *   tabs:    { [key]: { visible?: bool, title?: string, order?: number } },
 *   widgets: { [key]: { ...future per-widget settings... } }
 * }
 * Unknown keys are preserved on save, so future settings survive round trips.
 */

export const DASHBOARD_VIEWS = [
  { key: 'inventory',      label: 'Inventory Dashboard' },
  { key: 'infrastructure', label: 'VMware & Proxmox' },
];

export const DASHBOARD_TABS = [
  { key: 'exec',   defaultTitle: 'Executive Overview', description: 'Summary tiles, MSL & endpoint compliance' },
  { key: 'asset',  defaultTitle: 'Asset Inventory',    description: 'Status, patching, and location charts' },
  { key: 'ext',    defaultTitle: 'Extended Inventory', description: 'Ext. endpoint compliance and distribution' },
  { key: 'weekly', defaultTitle: 'Weekly Report',      description: 'The formal compliance report' },
];

// Widgets inside each tab — show/hide and rename via Dashboard Settings.
// Register future widgets here and they become configurable automatically.
export const DASHBOARD_WIDGETS = {
  exec: [
    { key: 'kpi_cards',      defaultTitle: 'Headline KPI cards', renamable: false },
    { key: 'asset_summary',  defaultTitle: 'Asset Inventory Summary' },
    { key: 'ext_summary',    defaultTitle: 'Extended Inventory Summary' },
    { key: 'msl_compliance', defaultTitle: 'Total Inventory MSL Compliance' },
    { key: 'ext_compliance', defaultTitle: 'Ext. Endpoint Compliance' },
  ],
  asset: [
    { key: 'os_chart',        defaultTitle: 'Assets by OS Type' },
    { key: 'status_chart',    defaultTitle: 'Assets by Server Status' },
    { key: 'location_chart',  defaultTitle: 'Assets by Location' },
    { key: 'eol_chart',       defaultTitle: 'EOL Status' },
    { key: 'active_status',   defaultTitle: 'Asset Inventory Active Status' },
    { key: 'patching_status', defaultTitle: 'Asset Inventory Patching Status' },
    { key: 'vm_by_location',  defaultTitle: 'VM Count by Location' },
    { key: 'recent_assets',   defaultTitle: 'Recent Assets' },
  ],
  ext: [
    { key: 'kpi_cards',         defaultTitle: 'Headline KPI cards', renamable: false },
    { key: 'ext_summary',       defaultTitle: 'Extended Inventory Summary' },
    { key: 'ext_compliance',    defaultTitle: 'Ext. Endpoint Compliance' },
    { key: 'dept_distribution', defaultTitle: 'Ext. Dept-wise Endpoint Distribution' },
  ],
  weekly: [
    { key: 'masthead',           defaultTitle: 'Report masthead (week stamp + figures)', renamable: false },
    { key: 'asset_inventory',    defaultTitle: 'Asset Inventory' },
    { key: 'extended_inventory', defaultTitle: 'Extended Inventory' },
    { key: 'patch_management',   defaultTitle: 'Patch Management Solution' },
    { key: 'location_patching',  defaultTitle: 'Location wise auto/Manual-patching status:' },
    { key: 'department_patching', defaultTitle: 'Departments Patching Onboarding Status:' },
    { key: 'me_compliance',      defaultTitle: 'Auto Patching Group Count Status' },
  ],
};

// ── Custom widget builder vocabulary ─────────────────────────────────────
// End users create their own widgets from these safe building blocks; the
// backend whitelists the same sources/fields.
export const WIDGET_SOURCES = [
  { value: 'all',                   label: 'All inventories' },
  { value: 'assets',                label: 'MSL Assets' },
  { value: 'beijing_assets',        label: 'Beijing Assets' },
  { value: 'ext_assets',            label: 'Ext. Assets' },
  { value: 'physical_esxi_servers', label: 'Physical / ESXi' },
];
export const WIDGET_FIELDS = [
  { value: 'os_type',       label: 'OS Type' },
  { value: 'server_status', label: 'Server Status' },
  { value: 'location',      label: 'Location' },
  { value: 'eol_status',    label: 'EOL Status' },
  { value: 'department',    label: 'Department' },
  { value: 'patching_type', label: 'Patching Type' },
  { value: 'asset_type',    label: 'Asset Type' },
  { value: 'ome_status',    label: 'OME Status' },
  { value: 'assigned_user', label: 'Assigned User' },
];
export const WIDGET_TYPES = [
  { value: 'stat',   label: 'Number (count)',  needsGroupBy: false },
  { value: 'pie',    label: 'Pie chart',       needsGroupBy: true },
  { value: 'column', label: 'Column chart',    needsGroupBy: true },
  { value: 'table',  label: 'Table',           needsGroupBy: true },
];

export function customWidgetsFor(config, tab) {
  return (config?.custom_widgets || [])
    .filter(w => w && w.tab === tab && w.title && w.type)
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

// Individual report lines (weekly report sections). Stored under
// config.report_lines[section][key] = { visible, text } — text is a template
// where {tokens} are replaced with live numbers at render time.
export function resolveLine(config, section, key) {
  const l = config?.report_lines?.[section]?.[key] || {};
  return {
    visible: l.visible !== false,
    text:    l.text?.trim() || null,
  };
}

export function resolveWidget(config, tab, key) {
  const w = config?.widgets?.[tab]?.[key] || {};
  return {
    visible: w.visible !== false,
    title:   w.title?.trim() || null,
  };
}

// Merge stored config over registry defaults → ordered list of tabs.
export function resolveTabs(config) {
  const cfg = config?.tabs || {};
  return DASHBOARD_TABS
    .map((t, i) => ({
      ...t,
      visible: cfg[t.key]?.visible !== false,
      title:   cfg[t.key]?.title?.trim() || t.defaultTitle,
      order:   Number.isFinite(cfg[t.key]?.order) ? cfg[t.key].order : i,
    }))
    .sort((a, b) => a.order - b.order);
}

export function resolveDefaultView(config) {
  const v = config?.default_view;
  return DASHBOARD_VIEWS.some(x => x.key === v) ? v : 'inventory';
}

export function resolveDefaultTab(config) {
  const tabs = resolveTabs(config).filter(t => t.visible);
  if (!tabs.length) return 'exec';
  const wanted = config?.default_tab;
  return tabs.some(t => t.key === wanted) ? wanted : tabs[0].key;
}
