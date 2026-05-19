const db = require('../config/db');
const ApiError = require('../utils/ApiError');
const fieldVis = require('./fieldVisibilityService');

// Default groups (sections) with their order.
const DEFAULT_GROUPS = [
  'Identity',
  'Ownership',
  'Operations',
  'Asset Tagging & Credentials',
  'Tools',
];

// Map fieldVisibilityService.PAGES section → display group.
// (fieldVisibilityService uses 'Basic Information', 'Host Details', etc.
// in its ASSET_FIELDS list, but the AssetForm uses different Divider
// labels. We standardize on the AssetForm's groups here so the editor
// reflects what users actually see.)
const FIELD_GROUP_MAP = {
  vm_name: 'Identity',
  os_hostname: 'Identity',
  ip_address: 'Identity',
  asset_type: 'Identity',
  os_type: 'Identity',
  os_version: 'Identity',
  assigned_user: 'Ownership',
  department: 'Ownership',
  business_purpose: 'Ownership',
  server_status: 'Operations',
  patching_type: 'Operations',
  server_patch_type: 'Operations',
  patching_schedule: 'Operations',
  location: 'Operations',
  eol_status: 'Operations',
  ome_status: 'Operations',
  hosted_ip: 'Operations',
  serial_number: 'Asset Tagging & Credentials',
  asset_username: 'Asset Tagging & Credentials',
  asset_password: 'Asset Tagging & Credentials',
  asset_tag: 'Asset Tagging & Credentials',
  additional_remarks: 'Asset Tagging & Credentials',
  manage_engine_installed: 'Tools',
  tenable_installed: 'Tools',
  idrac_enabled: 'Tools',
};

// Default input types for each built-in field. DB-linked fields stay
// frozen (linked_to_table=true) — admins cannot change their input
// because the data is driven by the dropdown_master / department tables.
const FIELD_DEFAULTS = {
  vm_name:                 { label: 'VM Name',                 type: 'text',     required: true },
  os_hostname:             { label: 'OS Hostname',             type: 'text' },
  ip_address:              { label: 'IP Address',              type: 'text',     required: true, frozen: true, frozen_reason: 'IP uniqueness validation' },
  asset_type:              { label: 'Asset Type',              type: 'text' },
  os_type:                 { label: 'OS Type',                 type: 'dropdown', linked_to_table: true, frozen: true, frozen_reason: 'Linked to dropdown_master' },
  os_version:              { label: 'OS Version',              type: 'dropdown', linked_to_table: true, frozen: true, frozen_reason: 'Linked to dropdown_master' },
  assigned_user:           { label: 'Assigned User',           type: 'text' },
  department:              { label: 'Department',              type: 'dropdown', linked_to_table: true, frozen: true, frozen_reason: 'Linked to department_tag_ranges' },
  business_purpose:        { label: 'Business Purpose',        type: 'textarea' },
  server_status:           { label: 'Server Status',           type: 'dropdown', linked_to_table: true, frozen: true, frozen_reason: 'Linked to dropdown_master' },
  patching_type:           { label: 'Patching Type',           type: 'dropdown', linked_to_table: true, frozen: true, frozen_reason: 'Linked to dropdown_master' },
  server_patch_type:       { label: 'Server Patch Type',       type: 'dropdown', linked_to_table: true, frozen: true, frozen_reason: 'Linked to dropdown_master' },
  patching_schedule:       { label: 'Patching Schedule',       type: 'dropdown', linked_to_table: true, frozen: true, frozen_reason: 'Linked to dropdown_master' },
  location:                { label: 'Location',                type: 'dropdown', linked_to_table: true, frozen: true, frozen_reason: 'Linked to dropdown_master' },
  eol_status:              { label: 'EOL Status',              type: 'dropdown', linked_to_table: true, frozen: true, frozen_reason: 'Linked to dropdown_master' },
  ome_status:              { label: 'OME Status',              type: 'text' },
  hosted_ip:               { label: 'Hosted IP',               type: 'text' },
  serial_number:           { label: 'Serial Number',           type: 'text' },
  asset_username:          { label: 'Asset Username',          type: 'text' },
  asset_password:          { label: 'Asset Password',          type: 'text',     frozen: true, frozen_reason: 'Encrypted credential' },
  asset_tag:               { label: 'Asset Tag',               type: 'text',     required: true, frozen: true, frozen_reason: 'Tag range validator' },
  additional_remarks:      { label: 'Additional Remarks',      type: 'textarea' },
  manage_engine_installed: { label: 'ManageEngine Installed',  type: 'toggle' },
  tenable_installed:       { label: 'Tenable Installed',       type: 'toggle' },
  idrac_enabled:           { label: 'iDRAC Enabled',           type: 'toggle' },
};

const PAGE_KEYS = new Set(['assets', 'beijing_assets', 'ext_assets', 'physical_esxi_servers']);

function slugifyKey(label) {
  return String(label || '')
    .toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 64) || `field_${Date.now()}`;
}

async function get(pageKey) {
  if (!PAGE_KEYS.has(pageKey)) throw new ApiError(404, 'Unknown built-in page');

  // Pull overrides + extras + hidden fields together.
  const [{ rows: overrideRows }, hidden, fieldVisData] = await Promise.all([
    db.query(`SELECT * FROM builtin_field_overrides WHERE page_key = $1`, [pageKey]),
    db.query(`SELECT hidden FROM page_field_visibility WHERE page_key = $1`, [pageKey])
      .then(r => r.rows[0]?.hidden || []),
    fieldVis.get(pageKey).catch(() => ({ fields: [] })),
  ]);

  const overrideMap = {};
  for (const r of overrideRows) overrideMap[r.field_key] = r;

  // Built-in fields (in registry order).
  const builtIns = Object.keys(FIELD_DEFAULTS).map((key, idx) => {
    const def = FIELD_DEFAULTS[key];
    const ov = overrideMap[key];
    return {
      field_key: key,
      is_extra: false,
      default_label: def.label,
      label: ov?.label || def.label,
      default_section: FIELD_GROUP_MAP[key] || 'Other',
      section: ov?.section || FIELD_GROUP_MAP[key] || 'Other',
      default_type: def.type,
      input_type: (def.frozen ? def.type : (ov?.input_type || def.type)),
      options: ov?.options || null,
      is_required: !!def.required,
      sort_order: ov?.sort_order ?? idx,
      frozen: !!def.frozen,
      frozen_reason: def.frozen_reason || null,
      linked_to_table: !!def.linked_to_table,
      is_hidden: hidden.includes(key),
    };
  });

  // Admin-added extra fields.
  const extras = overrideRows
    .filter(r => r.is_extra)
    .map(r => ({
      field_key: r.field_key,
      is_extra: true,
      label: r.label,
      section: r.section || 'Other',
      input_type: r.input_type || 'text',
      options: r.options || null,
      is_required: !!r.is_required,
      sort_order: r.sort_order ?? 9999,
      frozen: false,
      linked_to_table: false,
      is_hidden: hidden.includes(r.field_key),
    }));

  const allFields = [...builtIns, ...extras].sort((a, b) =>
    a.section === b.section ? a.sort_order - b.sort_order : 0);

  // Discover any non-default group names present in overrides/extras.
  const groupSet = new Set(DEFAULT_GROUPS);
  for (const f of allFields) groupSet.add(f.section);

  return {
    page_key: pageKey,
    groups: Array.from(groupSet),
    default_groups: DEFAULT_GROUPS,
    fields: allFields,
  };
}

// updates: [{ field_key, label?, section?, input_type?, options?, is_required?, sort_order? }]
async function upsertOverrides(pageKey, updates, userId) {
  if (!PAGE_KEYS.has(pageKey)) throw new ApiError(404, 'Unknown built-in page');
  if (!Array.isArray(updates) || !updates.length) return get(pageKey);

  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    for (const u of updates) {
      if (!u || !u.field_key) continue;
      const isBuiltIn = FIELD_DEFAULTS[u.field_key] != null;
      // Built-in: protect frozen fields from input_type changes.
      let inputType = u.input_type ?? null;
      if (isBuiltIn && FIELD_DEFAULTS[u.field_key].frozen) inputType = null;
      const options = u.options !== undefined ? u.options : null;
      await client.query(
        `INSERT INTO builtin_field_overrides
           (page_key, field_key, is_extra, label, section, input_type, options, is_required, sort_order, updated_by, updated_at)
         VALUES ($1,$2,FALSE,$3,$4,$5,$6,$7,$8,$9,NOW())
         ON CONFLICT (page_key, field_key) DO UPDATE
           SET label       = EXCLUDED.label,
               section     = EXCLUDED.section,
               input_type  = COALESCE(EXCLUDED.input_type, builtin_field_overrides.input_type),
               options     = EXCLUDED.options,
               is_required = EXCLUDED.is_required,
               sort_order  = EXCLUDED.sort_order,
               updated_by  = EXCLUDED.updated_by,
               updated_at  = NOW()`,
        [
          pageKey,
          u.field_key,
          u.label ?? null,
          u.section ?? null,
          inputType,
          options ? JSON.stringify(options) : null,
          !!u.is_required,
          u.sort_order ?? 0,
          userId || null,
        ]
      );
    }
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally { client.release(); }

  return get(pageKey);
}

async function createExtra(pageKey, body, userId) {
  if (!PAGE_KEYS.has(pageKey)) throw new ApiError(404, 'Unknown built-in page');
  const { label, section, input_type, options, is_required, sort_order } = body || {};
  if (!label) throw new ApiError(400, 'label is required');
  if (!input_type) throw new ApiError(400, 'input_type is required');
  let fieldKey = slugifyKey(body.field_key || label);
  // Disallow collision with built-ins.
  if (FIELD_DEFAULTS[fieldKey]) fieldKey = `${fieldKey}_x`;
  try {
    await db.query(
      `INSERT INTO builtin_field_overrides
         (page_key, field_key, is_extra, label, section, input_type, options, is_required, sort_order, updated_by, updated_at)
       VALUES ($1,$2,TRUE,$3,$4,$5,$6,$7,$8,$9,NOW())`,
      [
        pageKey, fieldKey,
        label, section || 'Other', input_type,
        options ? JSON.stringify(options) : null,
        !!is_required, sort_order ?? 9999,
        userId || null,
      ]
    );
  } catch (e) {
    if (e.code === '23505') throw new ApiError(409, 'A field with that key already exists');
    throw e;
  }
  return get(pageKey);
}

async function updateExtra(pageKey, fieldKey, body, userId) {
  if (!PAGE_KEYS.has(pageKey)) throw new ApiError(404, 'Unknown built-in page');
  const { rowCount } = await db.query(
    `UPDATE builtin_field_overrides
        SET label       = COALESCE($3, label),
            section     = COALESCE($4, section),
            input_type  = COALESCE($5, input_type),
            options     = COALESCE($6::jsonb, options),
            is_required = COALESCE($7, is_required),
            sort_order  = COALESCE($8, sort_order),
            updated_by  = $9,
            updated_at  = NOW()
      WHERE page_key = $1 AND field_key = $2 AND is_extra = TRUE`,
    [
      pageKey, fieldKey,
      body.label ?? null,
      body.section ?? null,
      body.input_type ?? null,
      body.options ? JSON.stringify(body.options) : null,
      body.is_required ?? null,
      body.sort_order ?? null,
      userId || null,
    ]
  );
  if (!rowCount) throw new ApiError(404, 'Extra field not found');
  return get(pageKey);
}

async function deleteExtra(pageKey, fieldKey) {
  if (!PAGE_KEYS.has(pageKey)) throw new ApiError(404, 'Unknown built-in page');
  const { rowCount } = await db.query(
    `DELETE FROM builtin_field_overrides WHERE page_key = $1 AND field_key = $2 AND is_extra = TRUE`,
    [pageKey, fieldKey]
  );
  if (!rowCount) throw new ApiError(404, 'Extra field not found');
}

async function resetField(pageKey, fieldKey) {
  if (!PAGE_KEYS.has(pageKey)) throw new ApiError(404, 'Unknown built-in page');
  if (FIELD_DEFAULTS[fieldKey] == null) throw new ApiError(400, 'Only built-in fields can be reset');
  await db.query(
    `DELETE FROM builtin_field_overrides WHERE page_key = $1 AND field_key = $2 AND is_extra = FALSE`,
    [pageKey, fieldKey]
  );
  return get(pageKey);
}

module.exports = {
  get,
  upsertOverrides,
  createExtra,
  updateExtra,
  deleteExtra,
  resetField,
  FIELD_DEFAULTS,
  DEFAULT_GROUPS,
};
