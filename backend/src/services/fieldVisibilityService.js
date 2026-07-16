const db = require('../config/db');
const ApiError = require('../utils/ApiError');
const physicalEsxiSvc = require('./physicalEsxiService');

const ASSET_FIELDS = [
  { key: 'vm_name',                 label: 'VM Name',                section: 'Identity',                 required: true },
  { key: 'os_hostname',             label: 'OS Hostname',            section: 'Identity' },
  { key: 'ip_address',              label: 'IP Address',             section: 'Identity',                 required: true },
  { key: 'asset_type',              label: 'Asset Type',             section: 'Identity' },
  { key: 'os_type',                 label: 'OS Type',                section: 'Identity' },
  { key: 'os_version',              label: 'OS Version',             section: 'Identity' },
  { key: 'mac_address',             label: 'MAC Address',            section: 'Identity' },
  { key: 'assigned_user',           label: 'Assigned User',          section: 'Ownership' },
  { key: 'department',              label: 'Department',             section: 'Ownership' },
  { key: 'business_purpose',        label: 'Business Purpose',       section: 'Ownership' },
  { key: 'server_status',           label: 'Server Status',          section: 'Operations' },
  { key: 'patching_type',           label: 'Patching Type',          section: 'Operations' },
  { key: 'server_patch_type',       label: 'Server Patch Type',      section: 'Operations' },
  { key: 'patching_schedule',       label: 'Patching Schedule',      section: 'Operations' },
  { key: 'location',                label: 'Location',               section: 'Operations' },
  { key: 'eol_status',              label: 'EOL Status',             section: 'Operations' },
  { key: 'ome_status',              label: 'OME Status',             section: 'Operations' },
  { key: 'hosted_ip',               label: 'Hosted IP',              section: 'Operations' },
  { key: 'serial_number',           label: 'Serial Number',          section: 'Asset Tagging & Credentials' },
  { key: 'asset_username',          label: 'Asset Username',         section: 'Asset Tagging & Credentials' },
  { key: 'asset_password',          label: 'Asset Password',         section: 'Asset Tagging & Credentials' },
  { key: 'asset_tag',               label: 'Asset Tag',              section: 'Asset Tagging & Credentials', required: true },
  { key: 'additional_remarks',      label: 'Additional Remarks',     section: 'Asset Tagging & Credentials' },
  { key: 'manage_engine_installed', label: 'ManageEngine Installed', section: 'Tools' },
  { key: 'tenable_installed',       label: 'Tenable Installed',      section: 'Tools' },
  { key: 'idrac_enabled',           label: 'iDRAC Enabled',          section: 'Tools' },
  { key: 'idrac_ip',                label: 'iDRAC IP',               section: 'Tools' },
];

// Physical & ESXi Servers fields that don't exist for the 3 VM-based asset
// pages above. Kept in sync with physicalEsxiService.ASSET_COLUMNS (the
// source of truth also used by inventoryFieldsService), not hand-duplicated.
const PHYSICAL_ESXI_ONLY_FIELDS = [
  { key: 'server_model',    label: 'Server Model',    section: 'Operations' },
  { key: 'cpu_cores',       label: 'CPU Cores',       section: 'Operations' },
  { key: 'ram_gb',          label: 'RAM (GB)',        section: 'Operations' },
  { key: 'total_disks',     label: 'Total Disks',     section: 'Operations' },
  { key: 'rack_number',     label: 'Rack Number',     section: 'Operations' },
  { key: 'server_position', label: 'Server Position', section: 'Operations' },
];

// physical_esxi_servers is a different table with a different column set —
// derive its field list from physicalEsxiService.ASSET_COLUMNS instead of
// hand-maintaining a separate one, so it can't drift out of sync again.
// (asset_password is handled specially by mapBody there and isn't listed in
// ASSET_COLUMNS, but is still a real, editable field — included here too.)
const PHYSICAL_ESXI_ALLOWED = new Set([...physicalEsxiSvc.ASSET_COLUMNS, 'asset_password']);
const PHYSICAL_ESXI_FIELDS = [
  ...ASSET_FIELDS.filter(f => PHYSICAL_ESXI_ALLOWED.has(f.key)),
  ...PHYSICAL_ESXI_ONLY_FIELDS,
];

const PAGES = {
  assets:                { key: 'assets',                label: 'Asset Inventory',           fields: ASSET_FIELDS },
  beijing_assets:        { key: 'beijing_assets',        label: 'Beijing Asset Inventory',   fields: ASSET_FIELDS },
  ext_assets:            { key: 'ext_assets',            label: 'Ext. Asset Inventory',      fields: ASSET_FIELDS },
  physical_esxi_servers: { key: 'physical_esxi_servers', label: 'Physical & ESXi Servers',   fields: PHYSICAL_ESXI_FIELDS },
};

function pages() {
  return Object.values(PAGES).map(p => ({ key: p.key, label: p.label, fields: p.fields }));
}

// Admin-added "extra" fields (created via Admin > Custom Pages > Add Field)
// aren't part of the static PAGES registry above — they live in
// builtin_field_overrides. Pull them in here so they show up on the Field
// Visibility page and can actually be hidden (see inventoryFieldsService.get,
// which already honors `hidden` for extras via is_hidden).
async function extraFields(pageKey) {
  const { rows } = await db.query(
    `SELECT field_key, label, section FROM builtin_field_overrides
      WHERE page_key = $1 AND is_extra = TRUE`,
    [pageKey]
  );
  return rows.map(r => ({ key: r.field_key, label: r.label, section: r.section || 'Other' }));
}

async function get(pageKey) {
  if (!PAGES[pageKey]) throw new ApiError(400, 'Unknown page');
  const [{ rows }, extras] = await Promise.all([
    db.query(`SELECT hidden FROM page_field_visibility WHERE page_key = $1`, [pageKey]),
    extraFields(pageKey),
  ]);
  const hidden = rows[0]?.hidden || [];
  return {
    page: PAGES[pageKey].key,
    label: PAGES[pageKey].label,
    fields: [...PAGES[pageKey].fields, ...extras],
    hidden,
  };
}

async function save(pageKey, hidden, userId) {
  if (!PAGES[pageKey]) throw new ApiError(400, 'Unknown page');
  const extras = await extraFields(pageKey);
  const validKeys = new Set([...PAGES[pageKey].fields.map(f => f.key), ...extras.map(f => f.key)]);
  const required  = new Set(PAGES[pageKey].fields.filter(f => f.required).map(f => f.key));
  const cleaned = Array.from(new Set(
    (Array.isArray(hidden) ? hidden : [])
      .filter(k => validKeys.has(k) && !required.has(k))
  ));
  await db.query(
    `INSERT INTO page_field_visibility (page_key, hidden, updated_by, updated_at)
     VALUES ($1, $2::jsonb, $3, NOW())
     ON CONFLICT (page_key) DO UPDATE
       SET hidden = EXCLUDED.hidden,
           updated_by = EXCLUDED.updated_by,
           updated_at = NOW()`,
    [pageKey, JSON.stringify(cleaned), userId || null]
  );
  return get(pageKey);
}

module.exports = { pages, get, save, PAGES };
