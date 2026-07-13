const svc = require('../services/endpointCentralService');

async function getConfig(req, res, next) {
  try {
    const cfg     = await svc.getConfig();
    const isAdmin = ['admin', 'superadmin'].includes(req.user?.role);
    const authMode = cfg.auth_mode || 'api_key';

    res.json({
      server_url:    cfg.server_url    || '',
      customer_id:   cfg.customer_id   || '1',
      api_key:       isAdmin ? (cfg.api_key || '') : (cfg.api_key ? '••••••••' : ''),
      api_path:      cfg.api_path      || '',
      verify_ssl:    cfg.verify_ssl    || false,
      auth_mode:     authMode,
      auth_username: cfg.auth_username || '',
      // Never expose the password; only indicate whether one is stored
      auth_password_set: !!(cfg.auth_password),
      // Session is active when a token is stored
      session_active: !!(cfg.session_token),
      configured:  authMode === 'credentials'
        ? !!(cfg.server_url && cfg.auth_username && cfg.session_token)
        : !!(cfg.server_url && cfg.api_key),
      updated_by:  cfg.updated_by  || null,
      updated_at:  cfg.updated_at  || null,
    });
  } catch (e) { next(e); }
}

async function saveConfig(req, res, next) {
  try {
    const { server_url, customer_id, api_key, api_path, verify_ssl, auth_mode, auth_username, auth_password } = req.body;
    await svc.saveConfig(
      { server_url, customer_id, api_key, api_path, verify_ssl, auth_mode, auth_username, auth_password },
      req.user?.id
    );
    res.json({ ok: true });
  } catch (e) { next(e); }
}

// POST /endpoint-central/login
// Initiates credential-based auth. Returns { otp_required, unique_user_id } or { ok, token_saved }.
async function loginWithCredentials(req, res, next) {
  try {
    const cfg = await svc.getConfig();
    const serverUrl  = cfg.server_url?.trim();
    const verifySsl  = cfg.verify_ssl;
    const customerId = cfg.customer_id;

    // Accept username/password from body OR fall back to stored credentials
    const username = (req.body.username || cfg.auth_username || '').trim();
    const password = req.body.password  || cfg.auth_password || '';

    if (!serverUrl)  { res.status(400).json({ error: 'Server URL is not configured' }); return; }
    if (!username)   { res.status(400).json({ error: 'Username is required' });          return; }
    if (!password)   { res.status(400).json({ error: 'Password is required' });          return; }

    const result = await svc.loginWithCredentials({ serverUrl, username, password, customerId, verifySsl });

    if (!result.otp_required) {
      // No 2FA — store token immediately
      await svc.saveSessionToken(result.auth_token);
      res.json({ ok: true, otp_required: false });
    } else {
      // Return the unique_user_id to the frontend so it can complete OTP step
      res.json({ ok: true, otp_required: true, unique_user_id: result.unique_user_id });
    }
  } catch (e) { next(e); }
}

// POST /endpoint-central/login/otp
// Completes the 2FA flow. Body: { unique_user_id, otp }
async function validateOtp(req, res, next) {
  try {
    const cfg = await svc.getConfig();
    const { unique_user_id, otp } = req.body;

    if (!unique_user_id) { res.status(400).json({ error: 'unique_user_id is required' }); return; }
    if (!otp)            { res.status(400).json({ error: 'OTP code is required' });        return; }

    const result = await svc.validateOtpCode({
      serverUrl:      cfg.server_url,
      unique_user_id,
      otp,
      verifySsl:      cfg.verify_ssl,
    });

    await svc.saveSessionToken(result.auth_token);
    res.json({ ok: true });
  } catch (e) { next(e); }
}

async function testConnection(req, res, next) {
  try {
    const result = await svc.testConnection();
    res.json(result);
  } catch (e) { next(e); }
}

async function listAgents(req, res, next) {
  try {
    const agents = await svc.fetchAgents();
    res.json({ agents, total: agents.length });
  } catch (e) { next(e); }
}

async function listSoftware(req, res, next) {
  try {
    // Forward documented ME EC filter params if provided by the client
    const { domainFilter, licensetypefilter, accesstypefilter, compliancestatusfilter } = req.query;
    const filters = {};
    if (domainFilter)            filters.domainFilter            = domainFilter;
    if (licensetypefilter        != null && licensetypefilter        !== '') filters.licensetypefilter        = licensetypefilter;
    if (accesstypefilter         != null && accesstypefilter         !== '') filters.accesstypefilter         = accesstypefilter;
    if (compliancestatusfilter   != null && compliancestatusfilter   !== '') filters.compliancestatusfilter   = compliancestatusfilter;
    const software = await svc.fetchSoftware(filters);
    res.json({ software, total: software.length });
  } catch (e) { next(e); }
}

module.exports = { getConfig, saveConfig, testConnection, listAgents, listSoftware, loginWithCredentials, validateOtp };
