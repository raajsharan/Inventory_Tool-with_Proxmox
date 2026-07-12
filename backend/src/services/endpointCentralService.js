/**
 * endpointCentralService.js
 * --------------------------
 * Connects to ManageEngine Endpoint Central (formerly Desktop Central) REST API.
 * Reads computer / agent inventory using an API key (no session login required).
 *
 * The API path varies by product version:
 *   v10.x  /api/1.4/computers
 *   v11+   /api/1.4/patch/allsystems  (most common alternate)
 *   older  /dcapi/rd/computers
 *
 * When api_path is left blank, the service auto-discovers by trying each known
 * path in order and using the first one that returns a 200 with valid JSON.
 */

const https = require('https');
const http  = require('http');
const db    = require('../config/db');

// ---------------------------------------------------------------------------
// Known API paths to try during auto-discovery (in priority order)
// ---------------------------------------------------------------------------

const KNOWN_PATHS = [
  '/api/1.4/computers',
  '/api/1.4/patch/allsystems',
  '/api/1.4/patch/systems/allsystems',
  '/api/1.4/inventory/computers',
  '/dcapi/rd/computers',
];

// ---------------------------------------------------------------------------
// Low-level HTTP helper
// ---------------------------------------------------------------------------

function httpRequest(urlStr, options = {}) {
  return new Promise((resolve, reject) => {
    const url     = new URL(urlStr);
    const isHttps = url.protocol === 'https:';
    const lib     = isHttps ? https : http;

    const reqOpts = {
      hostname: url.hostname,
      port:     url.port || (isHttps ? 443 : 80),
      path:     url.pathname + url.search,
      method:   options.method || 'GET',
      headers:  {
        'Content-Type': 'application/json',
        ...(options.headers || {}),
      },
      ...(isHttps && !options.verifySsl ? { rejectUnauthorized: false } : {}),
      timeout: 15000,
    };

    const req = lib.request(reqOpts, (res) => {
      let body = '';
      res.on('data', c => { body += c; });
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });

    req.on('timeout', () => { req.destroy(); reject(new Error('Request timed out')); });
    req.on('error',   reject);

    if (options.body) req.write(options.body);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Config CRUD
// ---------------------------------------------------------------------------

const DEFAULT_CONFIG = {
  server_url:  '',
  customer_id: '1',
  api_key:     '',
  api_path:    '',
  verify_ssl:  false,
};

async function getConfig() {
  const { rows } = await db.query('SELECT * FROM endpoint_central_config WHERE id = 1');
  return rows[0] || DEFAULT_CONFIG;
}

async function saveConfig({ server_url, customer_id, api_key, api_path, verify_ssl }, updatedBy) {
  await db.query(`
    INSERT INTO endpoint_central_config
      (id, server_url, customer_id, api_key, api_path, verify_ssl, updated_by, updated_at)
    VALUES (1, $1, $2, $3, $4, $5, $6, NOW())
    ON CONFLICT (id) DO UPDATE SET
      server_url  = EXCLUDED.server_url,
      customer_id = EXCLUDED.customer_id,
      api_key     = EXCLUDED.api_key,
      api_path    = EXCLUDED.api_path,
      verify_ssl  = EXCLUDED.verify_ssl,
      updated_by  = EXCLUDED.updated_by,
      updated_at  = NOW()
  `, [server_url || '', customer_id || '1', api_key || '', api_path || '', !!verify_ssl, updatedBy || null]);
}

// ---------------------------------------------------------------------------
// Response extraction — handles different response shapes across versions
// ---------------------------------------------------------------------------

function extractComputers(json) {
  // v10.x:         { data: { computers: [...] } }
  // v11 patch:     { data: { allsystemsdetail: [...] } }
  // older:         { message_response: { computer: [...] } }
  // some versions: { computers: [...] } or { data: { computerdetails: [...] } }
  return (
    json?.data?.computers        ??
    json?.data?.allsystemsdetail ??
    json?.data?.computerdetails  ??
    json?.message_response?.computer ??
    json?.computers              ??
    []
  );
}

// ---------------------------------------------------------------------------
// Data normalisation — field names vary across ME EC versions
// ---------------------------------------------------------------------------

function normalizeComputer(c) {
  return {
    resource_id:    c.resource_id    ?? c.RESOURCE_ID    ?? c.resourceid    ?? null,
    computer_name:  c.computername   ?? c.COMPUTERNAME   ?? c.computer_name ?? '—',
    domain:         c.domain         ?? c.DOMAIN         ?? '—',
    ip_address:     c.ipaddress      ?? c.IP_ADDRESS      ?? c.ip_address    ?? '—',
    os_name:        c.osname         ?? c.OS_NAME         ?? c.osName        ?? c.os_name  ?? '—',
    os_platform:    c.osplatform     ?? c.OS_PLATFORM     ?? null,
    agent_version:  c.agentversion   ?? c.AGENT_VERSION   ?? c.agent_version ?? '—',
    // managed_status: 0 = Not Managed, 1 = Managed
    managed_status: c.managed_status ?? c.MANAGED_STATUS  ?? 1,
    // agent_status: 0 = Online/Active, 1 = Offline/Inactive
    agent_status:   c.agent_status   ?? c.AGENT_STATUS    ?? 1,
    last_sync:      c.lastsync       ?? c.LAST_SYNC        ?? c.last_sync     ?? null,
    office:         c.resourceoffice ?? c.RESOURCE_OFFICE  ?? c.office        ?? '—',
    resource_type:  c.resourcetype   ?? c.RESOURCE_TYPE    ?? 0,
  };
}

// ---------------------------------------------------------------------------
// Build URL for a given path
// ---------------------------------------------------------------------------

function buildUrl(serverUrl, path, apiKey, customerId) {
  const base = serverUrl.replace(/\/$/, '');
  return `${base}${path}?apikey=${encodeURIComponent(apiKey)}&customerid=${encodeURIComponent(customerId || '1')}`;
}

// ---------------------------------------------------------------------------
// Try one path — returns { ok, json, count } or null on non-200
// ---------------------------------------------------------------------------

async function tryPath(serverUrl, path, apiKey, customerId, verifySsl) {
  try {
    const url = buildUrl(serverUrl, path, apiKey, customerId);
    const { status, body } = await httpRequest(url, { verifySsl });
    if (status < 200 || status >= 300) return null;
    let json;
    try { json = JSON.parse(body); } catch { return null; }
    const computers = extractComputers(json);
    if (!Array.isArray(computers)) return null;
    return { json, computers, path };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

async function fetchAgents() {
  const config = await getConfig();

  if (!config.server_url || !config.api_key) {
    const err = new Error('Endpoint Central is not configured — set Server URL and API Key first');
    err.status = 400;
    throw err;
  }

  const paths = config.api_path ? [config.api_path] : KNOWN_PATHS;

  for (const path of paths) {
    const result = await tryPath(
      config.server_url, path, config.api_key, config.customer_id, config.verify_ssl
    );
    if (result) return result.computers.map(normalizeComputer);
  }

  const tried = paths.join(', ');
  throw new Error(
    `Endpoint Central did not respond successfully to any known API path. Tried: ${tried}. ` +
    'Check the Server URL, API Key, and set the API Path manually if needed.'
  );
}

async function testConnection() {
  const config = await getConfig();

  if (!config.server_url || !config.api_key) {
    return { success: false, error: 'Server URL and API Key are required' };
  }

  const paths = config.api_path ? [config.api_path] : KNOWN_PATHS;

  for (const path of paths) {
    try {
      const url = buildUrl(config.server_url, path, config.api_key, config.customer_id);
      const { status, body } = await httpRequest(url, { verifySsl: config.verify_ssl });

      if (status >= 200 && status < 300) {
        let json;
        try { json = JSON.parse(body); } catch {
          return { success: false, error: 'Server responded but returned non-JSON — check Server URL' };
        }
        const computers = extractComputers(json);
        if (Array.isArray(computers)) {
          return {
            success: true,
            message: `Connected via ${path} — ${computers.length} endpoint(s) found`,
            working_path: path,
          };
        }
        // Got 200 but unrecognised shape — keep trying
        continue;
      }

      // Got a structured error response — report it with the path context
      let detail = body.slice(0, 300);
      try {
        const j = JSON.parse(body);
        if (j.errorMsg) detail = j.errorMsg;
        else if (j.message) detail = j.message;
      } catch { /* keep raw */ }

      // Only stop early on auth errors, not 404s (wrong path)
      if (status === 401 || status === 403) {
        return { success: false, error: `Authentication failed (HTTP ${status}): ${detail}` };
      }
      // 404 = wrong path, continue to next
    } catch (e) {
      return { success: false, error: e.message };
    }
  }

  return {
    success: false,
    error: `None of the known API paths returned a valid response. Paths tried: ${paths.join(', ')}. ` +
           'Set the API Path field manually to the correct endpoint for your ME EC version.',
  };
}

module.exports = { getConfig, saveConfig, fetchAgents, testConnection, KNOWN_PATHS };
