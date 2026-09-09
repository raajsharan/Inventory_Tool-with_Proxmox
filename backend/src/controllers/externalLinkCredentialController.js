const svc = require('../services/externalLinkCredentialService');

async function get(req, res, next) {
  try {
    const cred = await svc.get(req.user.id, req.params.linkKey);
    res.json(cred || { username: '', password: '' });
  } catch (e) { next(e); }
}

async function save(req, res, next) {
  try {
    const { username, password } = req.body || {};
    if (!username?.trim() || !password) {
      res.status(400).json({ error: 'Username and password are required' });
      return;
    }
    const cred = await svc.save(req.user.id, req.params.linkKey, { username: username.trim(), password });
    res.json(cred);
  } catch (e) { next(e); }
}

async function remove(req, res, next) {
  try {
    await svc.remove(req.user.id, req.params.linkKey);
    res.json({ ok: true });
  } catch (e) { next(e); }
}

module.exports = { get, save, remove };
