const db = require('../config/db');
const ApiError = require('../utils/ApiError');

// Canonical defaults for built-in pages. Overrides are layered on top.
const DEFAULTS = {
  assets:                { name: 'Assets',                  description: 'Primary asset inventory.',               path: '/assets' },
  beijing_assets:        { name: 'Beijing Assets',          description: 'Beijing region asset inventory.',        path: '/beijing-assets' },
  ext_assets:            { name: 'Ext. Assets',             description: 'Extended asset inventory.',              path: '/ext-assets' },
  physical_esxi_servers: { name: 'Physical & ESXi Servers', description: 'Physical hardware and ESXi hypervisors.', path: '/physical-esxi' },
};

const ALLOWED_KEYS = new Set(Object.keys(DEFAULTS));

async function list() {
  const { rows } = await db.query(
    `SELECT page_key, name, description, icon, updated_at FROM builtin_page_overrides`
  );
  const overrides = {};
  for (const r of rows) overrides[r.page_key] = r;
  return Object.entries(DEFAULTS).map(([key, def]) => {
    const o = overrides[key] || {};
    return {
      page_key:    key,
      default_name:        def.name,
      default_description: def.description,
      path:                def.path,
      name:        o.name || def.name,
      description: o.description ?? def.description,
      icon:        o.icon || null,
      is_overridden: !!overrides[key],
      updated_at:  o.updated_at || null,
    };
  });
}

async function update(pageKey, body, userId) {
  if (!ALLOWED_KEYS.has(pageKey)) throw new ApiError(404, 'Unknown built-in page');
  const name = body.name == null ? null : String(body.name).trim() || null;
  const description = body.description == null ? null : String(body.description);
  const icon = body.icon == null ? null : String(body.icon).trim() || null;
  await db.query(
    `INSERT INTO builtin_page_overrides (page_key, name, description, icon, updated_by, updated_at)
     VALUES ($1, $2, $3, $4, $5, NOW())
     ON CONFLICT (page_key) DO UPDATE
       SET name        = EXCLUDED.name,
           description = EXCLUDED.description,
           icon        = EXCLUDED.icon,
           updated_by  = EXCLUDED.updated_by,
           updated_at  = NOW()`,
    [pageKey, name, description, icon, userId || null]
  );
  return (await list()).find(p => p.page_key === pageKey);
}

async function reset(pageKey) {
  if (!ALLOWED_KEYS.has(pageKey)) throw new ApiError(404, 'Unknown built-in page');
  await db.query(`DELETE FROM builtin_page_overrides WHERE page_key = $1`, [pageKey]);
}

module.exports = { list, update, reset, DEFAULTS };
