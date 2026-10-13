const db = require('../config/db');
const ApiError = require('../utils/ApiError');

// Defaults mirror what was hardcoded in hostnamePattern.js before this
// became admin-editable — so behavior is unchanged until someone edits it
// from Dropdown Master. site_codes keys are Location dropdown values; an
// admin-added Location with no entry here just can't suggest a hostname yet
// (same "missing input" treatment the panel already gives a blank Team/Tier).
const DEFAULT_CONFIG = {
  site_codes: {
    Beijing: 'BJS',
    Toronto: 'TOR',
    Burlington: 'BUR',
    'Boston Bomgar': 'BOS',
  },
  team_codes: [
    { code: 'ITO', label: 'IT Team' },
    { code: 'LAB', label: 'Lab Team' },
    { code: 'QAT', label: 'QA Team' },
    { code: 'DEV', label: 'Development Team' },
    { code: 'DVO', label: 'Dev-Ops Team' },
    { code: 'SNP', label: 'Support and Service Team' },
    { code: 'PLT', label: 'Platform Team' },
    { code: 'SEC', label: 'Application Security Team' },
    { code: 'PSE', label: 'Pre-Sales Engineer Team' },
    { code: 'NEA', label: 'Network Engineering Automation Team' },
  ],
  tier_codes: [
    { code: 'P', label: 'Production' },
    { code: 'S', label: 'Staging' },
    { code: 'D', label: 'Development' },
    { code: 'T', label: 'Testing' },
    { code: 'C', label: 'Customer-facing' },
    { code: 'G', label: 'General Purpose' },
  ],
  // Which Asset Type values show the Suggested Hostname panel at all — e.g.
  // an LXC Container doesn't get renamed the same way a VM/server does, so
  // it's deliberately left out of the default set.
  applicable_asset_types: ['VM', 'ESXi', 'Desktop', 'Physical Server', 'Bare Metal Server'],
  // Order the 5 segments are concatenated in. Original behavior was this
  // fixed order baked into code — now just the default.
  segment_order: ['site', 'os', 'team', 'tier', 'asset_tag'],
};

const CODE_RE = /^[A-Z0-9]{1,4}$/;
const SEGMENT_KEYS = ['site', 'os', 'team', 'tier', 'asset_tag'];

function validate(config) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    throw new ApiError(400, 'config object is required');
  }
  const { site_codes, team_codes, tier_codes, applicable_asset_types } = config;

  if (site_codes !== undefined) {
    if (typeof site_codes !== 'object' || Array.isArray(site_codes)) throw new ApiError(400, 'site_codes must be an object of { location: code }');
    for (const [loc, code] of Object.entries(site_codes)) {
      if (code !== null && code !== '' && !CODE_RE.test(code)) {
        throw new ApiError(400, `Site code for "${loc}" must be 1-4 uppercase letters/digits`);
      }
    }
  }

  const validateCodeList = (list, name) => {
    if (list === undefined) return;
    if (!Array.isArray(list)) throw new ApiError(400, `${name} must be an array`);
    const seen = new Set();
    for (const row of list) {
      if (!row || typeof row.code !== 'string' || typeof row.label !== 'string') {
        throw new ApiError(400, `Each ${name} entry needs a code and a label`);
      }
      if (!CODE_RE.test(row.code)) throw new ApiError(400, `${name} code "${row.code}" must be 1-4 uppercase letters/digits`);
      if (!row.label.trim()) throw new ApiError(400, `${name} code "${row.code}" needs a label`);
      if (seen.has(row.code)) throw new ApiError(400, `${name} code "${row.code}" is duplicated`);
      seen.add(row.code);
    }
  };
  validateCodeList(team_codes, 'Team');
  validateCodeList(tier_codes, 'Tier');

  if (applicable_asset_types !== undefined) {
    if (!Array.isArray(applicable_asset_types) || applicable_asset_types.some(v => typeof v !== 'string')) {
      throw new ApiError(400, 'applicable_asset_types must be an array of strings');
    }
  }

  const { segment_order } = config;
  if (segment_order !== undefined) {
    const isPermutation = Array.isArray(segment_order)
      && segment_order.length === SEGMENT_KEYS.length
      && SEGMENT_KEYS.every(k => segment_order.includes(k));
    if (!isPermutation) {
      throw new ApiError(400, `segment_order must list each of ${SEGMENT_KEYS.join(', ')} exactly once`);
    }
  }
}

async function getConfig(_req, res, next) {
  try {
    const { rows } = await db.query('SELECT config, updated_at FROM hostname_pattern_config WHERE id = 1');
    const stored = rows[0]?.config;
    // Merge over defaults (rather than replace) so a config saved before a
    // new field existed (e.g. segment_order) still gets that field's
    // default instead of silently missing it.
    res.json({
      config: (stored && Object.keys(stored).length) ? { ...DEFAULT_CONFIG, ...stored } : DEFAULT_CONFIG,
      updated_at: rows[0]?.updated_at || null,
    });
  } catch (e) { next(e); }
}

async function saveConfig(req, res, next) {
  try {
    const { config } = req.body || {};
    validate(config);
    const { rows } = await db.query(
      `INSERT INTO hostname_pattern_config (id, config, updated_by, updated_at)
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
