const jwt = require('jsonwebtoken');
const ApiError = require('../utils/ApiError');
const db = require('../config/db');

async function authenticate(req, _res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return next(new ApiError(401, 'Missing token'));
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    // Re-check current DB state on every request so a deactivation or role
    // change takes effect immediately instead of waiting for the token to
    // expire (the JWT payload alone is a stale snapshot from login time).
    const { rows } = await db.query(
      `SELECT is_active, role FROM users WHERE id = $1`,
      [payload.id]
    );
    const current = rows[0];
    if (!current || !current.is_active) {
      return next(new ApiError(401, 'Invalid or expired token'));
    }
    req.user = { ...payload, role: current.role };
    return next();
  } catch (e) {
    return next(new ApiError(401, 'Invalid or expired token'));
  }
}

function authorize(...roles) {
  return (req, _res, next) => {
    if (!req.user) return next(new ApiError(401, 'Unauthenticated'));
    if (req.user.role === 'superadmin') return next(); // god mode
    if (roles.length && !roles.includes(req.user.role)) {
      return next(new ApiError(403, 'Forbidden: insufficient role'));
    }
    return next();
  };
}

// Per-page RBAC check, layered on top of authenticate + authorize.
function requirePageAccess(pageKey) {
  return async (req, _res, next) => {
    try {
      if (!req.user) return next(new ApiError(401, 'Unauthenticated'));
      if (req.user.role === 'superadmin') return next();
      const svc = require('../services/pageAccessService');
      const ok = await svc.canUser(req.user.id, req.user.role, pageKey);
      if (!ok) return next(new ApiError(403, 'Page access denied for your account'));
      return next();
    } catch (e) { return next(e); }
  };
}

// Middleware: ensures user has can_view_passwords permission (superadmin always passes)
function requirePasswordAccess(req, _res, next) {
  if (!req.user) return next(new ApiError(401, 'Unauthenticated'));
  if (req.user.role === 'superadmin') return next();
  const db = require('../config/db');
  db.query(`SELECT can_view_passwords FROM users WHERE id = $1`, [req.user.id])
    .then(({ rows }) => {
      if (!rows[0]?.can_view_passwords) {
        return next(new ApiError(403, 'Password viewing not permitted for your account'));
      }
      return next();
    })
    .catch(next);
}

module.exports = { authenticate, authorize, requirePageAccess, requirePasswordAccess };
