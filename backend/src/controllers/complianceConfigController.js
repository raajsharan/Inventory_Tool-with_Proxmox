const db = require('../config/db');

// Defaults shown on first load and used as fallback in queries.
const DEFAULT_CONFIG = {
  msl: {
    include_asset_types:       ['VM', 'Bare Metal Server', 'Physical Server', 'Other'],
    include_server_statuses:   ['Alive', 'Alive But Powered Off', 'Need to check', 'Decommissioned'],
    exclude_eol_statuses:      ['Decom', 'Not Applicable'],
    include_password_statuses: ['Known'],
    pivot: 'location',
  },
  ext: {
    exclude_item_statuses:        [],
    exclude_eol_statuses:         [],
    me_na_patching_types:         ['Exception', 'Beijing IT Team'],
    me_na_server_statuses:        ['Not Alive'],
    me_na_eol_statuses:           ['Decom', 'Not Applicable'],
    me_na_requires_not_installed: true,
    auto_patching_types:          ['Auto'],
    manual_patching_types:        ['Manual'],
    name_conflict_fields:         ['vm_name', 'os_hostname'],
    hidden_ext_chips:             [],
    ext_chip_labels:              {},
  },
  weekly: {
    me_msl_exclude_buckets:     ['Beijing IT Team', 'Not Applicable', 'Alive But Powered Off', 'EOL - No Patches'],
    me_ext_exclude_buckets:     ['Beijing IT Team', 'Not Applicable', 'Alive But Powered Off', 'EOL - No Patches', 'Exception'],
    me_msl_footnote:            '',
    me_ext_footnote:            '',
    breakdown_hidden_columns:   [],
    breakdown_pct_exclude:      ['alive_powered_off', 'eol'],
    breakdown_excluded_locations:   [],
    breakdown_excluded_departments: [],
    report_title:    '',
    report_subtitle: '',
  },
};

async function getConfig(_req, res, next) {
  try {
    const { rows } = await db.query('SELECT config, updated_at FROM compliance_config WHERE id = 1');
    const stored = rows[0]?.config;
    res.json({
      config: (stored && Object.keys(stored).length) ? stored : DEFAULT_CONFIG,
      updated_at: rows[0]?.updated_at || null,
    });
  } catch (e) { next(e); }
}

async function saveConfig(req, res, next) {
  try {
    const ApiError = require('../utils/ApiError');
    const { config } = req.body || {};
    if (!config || typeof config !== 'object' || Array.isArray(config)) {
      throw new ApiError(400, 'config object is required');
    }
    const { rows } = await db.query(
      `INSERT INTO compliance_config (id, config, updated_by, updated_at)
       VALUES (1, $1, $2, NOW())
       ON CONFLICT (id) DO UPDATE
         SET config = EXCLUDED.config, updated_by = EXCLUDED.updated_by, updated_at = NOW()
       RETURNING config, updated_at`,
      [JSON.stringify(config), req.user.id],
    );
    res.json(rows[0]);
  } catch (e) { next(e); }
}

module.exports = { getConfig, saveConfig, DEFAULT_CONFIG };
