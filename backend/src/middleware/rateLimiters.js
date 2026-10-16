const { rateLimit, ipKeyGenerator } = require('express-rate-limit');

// Keyed by authenticated user when available, falling back to a (subnet-
// normalized, IPv6-safe) IP — every route these apply to already runs after
// `authenticate`, so req.user is set except on the rare path that doesn't
// require login at all.
const byUserOrIp = (req) => req.user?.id || ipKeyGenerator(req.ip);

// Generous baseline applied to the whole /api surface — not meant to bother
// any real usage pattern, just to put a ceiling under scripted abuse that
// today has no limit at all once past login. The shared layout alone (sidebar
// nav, page-access matrix, dropdowns, branding, the alert bell) fires a
// double-digit number of requests on every single navigation, so a human
// clicking quickly through a dozen pages can legitimately clear several
// hundred requests in under a minute — this only needs to catch something
// well beyond that, not budget normal browsing.
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 1200,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: byUserOrIp,
});

// The dashboard summary endpoint fans out ~20+ parallel SQL queries per hit —
// cheap to call, not cheap to serve. The UI itself only calls this on page
// load/tab switch, never on a tight poll.
const dashboardLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: byUserOrIp,
});

// Hostname rename and agent install/reinstall each trigger a live
// Ansible/SSH/WinRM run against a real managed host — spamming these is a
// DoS against that host (and its own auth/lockout policies), not just this
// app. Mostly manual, occasional admin actions — but the Assets / Physical &
// ESXi Servers forms can now also fire up to 3 of these in one go per saved
// record (hostname rename + ManageEngine install + Nessus install), so a
// short run of onboarding several new servers back to back is normal, not
// abuse — raised from 10 to account for that without opening this up to a
// real tight loop.
const remoteActionLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: byUserOrIp,
});

// Bulk/smart-import endpoints parse and write whole spreadsheets — rare,
// deliberate admin/asset-manager actions.
const importLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: byUserOrIp,
});

module.exports = { apiLimiter, dashboardLimiter, remoteActionLimiter, importLimiter };
