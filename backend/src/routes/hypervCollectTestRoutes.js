const router = require('express').Router();
const { spawn } = require('child_process');
const path = require('path');
const { authenticate, authorize } = require('../middleware/auth');
const { remoteActionLimiter } = require('../middleware/rateLimiters');

// Test harness for scripts/hyperv_collect.py (WMI/DCOM via impacket). Takes
// credentials in the request body, nothing is stored. Admin-only.
const SCRIPT = path.join(__dirname, '..', '..', 'scripts', 'hyperv_collect.py');
const PYTHON = process.env.HYPERV_PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
const HOST_RE = /^[A-Za-z0-9]([A-Za-z0-9.-]{0,253}[A-Za-z0-9])?$/;
const TIMEOUT_MS = 120000;

router.post('/collect', authenticate, authorize('admin', 'superadmin'), remoteActionLimiter, (req, res) => {
  const { host, username, password, domain } = req.body || {};
  if (typeof host !== 'string' || !HOST_RE.test(host.trim())) {
    return res.status(400).json({ error: 'Enter a valid host name or IP address' });
  }
  if (!username || !password) return res.status(400).json({ error: 'Username and password are required' });

  const args = [SCRIPT, '--host', host.trim(), '--user', String(username), '--domain', String(domain || '')];
  const child = spawn(PYTHON, args, {
    env: { ...process.env, HYPERV_WIN_PASSWORD: String(password) },
  });
  let out = '';
  let err = '';
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; child.kill(); }, TIMEOUT_MS);
  child.stdout.on('data', d => { out += d.toString(); });
  child.stderr.on('data', d => { err += d.toString(); });
  child.on('error', e => {
    clearTimeout(timer);
    res.status(500).json({ error: `Could not start ${PYTHON}: ${e.message}` });
  });
  child.on('close', code => {
    clearTimeout(timer);
    if (res.headersSent) return;
    if (timedOut) return res.status(504).json({ error: `Timed out after ${TIMEOUT_MS / 1000}s` });
    let parsed = null;
    try { parsed = JSON.parse(out); } catch { /* fall through to stderr */ }
    if (code === 0 && parsed && !parsed.error) return res.json({ data: parsed });
    res.status(502).json({
      error: parsed?.error || err.trim().split('\n').slice(-3).join(' ') || `Collector exited with code ${code}`,
    });
  });
});

module.exports = router;
