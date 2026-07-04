const svc = require('../services/userPageAccessService');

async function listUsers(req, res, next) {
  try {
    res.json({ users: await svc.listUsersWithAccess() });
  } catch (e) { next(e); }
}

async function getMyAccess(req, res, next) {
  try {
    res.json(await svc.getMyAccess(req.user.id));
  } catch (e) { next(e); }
}

async function saveAccess(req, res, next) {
  try {
    const { can_view_passwords, page_access } = req.body;
    await svc.saveUserAccess(req.params.userId, { can_view_passwords, page_access }, req.user.id);
    res.json({ ok: true });
  } catch (e) { next(e); }
}

module.exports = { listUsers, getMyAccess, saveAccess };
