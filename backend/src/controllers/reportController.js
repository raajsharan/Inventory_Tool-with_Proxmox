const svc = require('../services/reportService');
const db = require('../config/db');
const ApiError = require('../utils/ApiError');

const PASSWORD_FIELD_KEY = 'asset_password';

async function userCanViewPasswords(user) {
  if (user.role === 'superadmin') return true;
  const { rows } = await db.query('SELECT can_view_passwords FROM users WHERE id = $1', [user.id]);
  return !!rows[0]?.can_view_passwords;
}

async function sources(_req, res, next) {
  try {
    res.json({ items: await svc.sources() });
  } catch (e) { next(e); }
}

async function run(req, res, next) {
  try {
    const columns = Array.isArray(req.body.columns) ? req.body.columns : [];
    const filters = Array.isArray(req.body.filters) ? req.body.filters : [];
    const wantsPasswords = columns.includes(PASSWORD_FIELD_KEY)
      || filters.some(f => f.field === PASSWORD_FIELD_KEY);
    const allowPasswords = wantsPasswords ? await userCanViewPasswords(req.user) : false;
    if (wantsPasswords && !allowPasswords) {
      throw new ApiError(403, 'Password viewing not permitted for your account');
    }

    const result = await svc.run({
      source: req.body.source,
      columns,
      filters,
      limit: req.body.limit,
      allowPasswords,
    });
    res.json(result);
  } catch (e) { next(e); }
}

module.exports = { sources, run };
