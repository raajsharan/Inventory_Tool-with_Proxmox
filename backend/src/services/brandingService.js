const db = require('../config/db');

async function get() {
  const { rows } = await db.query('SELECT * FROM app_branding WHERE id = 1');
  if (!rows.length) {
    return {
      id: 1,
      tool_name: 'Inventory IT',
      company_name: '',
      tagline: 'Infrastructure',
      footer_html: '',
      logo_data_url: null,
    };
  }
  return rows[0];
}

async function update(body, userId) {
  const allowed = ['tool_name', 'company_name', 'tagline', 'footer_html', 'logo_data_url'];
  const sets = [];
  const vals = [];
  for (const k of allowed) {
    if (body[k] !== undefined) {
      sets.push(`${k} = $${sets.length + 1}`);
      vals.push(body[k]);
    }
  }
  if (!sets.length) return get();
  vals.push(userId || null);
  sets.push(`updated_by = $${vals.length}`);
  sets.push(`updated_at = NOW()`);

  // Singleton-safe upsert: INSERT if missing, otherwise UPDATE.
  await db.query(
    `INSERT INTO app_branding (id) VALUES (1) ON CONFLICT (id) DO NOTHING`
  );
  const { rows } = await db.query(
    `UPDATE app_branding SET ${sets.join(', ')} WHERE id = 1 RETURNING *`,
    vals
  );
  return rows[0];
}

module.exports = { get, update };
