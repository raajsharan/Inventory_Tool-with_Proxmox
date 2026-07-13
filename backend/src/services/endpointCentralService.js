/**
 * endpointCentralService.js
 * --------------------------
 * Connects to ManageEngine Endpoint Central (formerly Desktop Central) REST API.
 *
 * Auth methods tried (in order):
 *   1. Query param:   ?apikey=<KEY>&customerid=<ID>           (older versions)
 *   2. Auth header:   Authorization: Authtoken <KEY>          (newer v11+ versions)
 *
 * API paths tried during auto-discovery (in order):
 *   /api/1.4/computers, /api/1.4/patch/allsystems,
 *   /api/1.4/inventory/computers, /dcapi/rd/computers,
 *   /api/1.4/patch/systems/allsystems
 */

const https = require('https');
const http  = require('http');
const db    = require('../config/db');

// ---------------------------------------------------------------------------
// Known API paths to try during auto-discovery
// ---------------------------------------------------------------------------

const KNOWN_PATHS = [
  '/api/1.4/computers',
  '/api/1.4/patch/allsystems',
  '/api/1.4/inventory/computers',
  '/dcapi/rd/computers',
  '/api/1.4/patch/systems/allsystems',
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
        'Content-Type':  'application/json',
        'Accept':        'application/json',
        ...(options.headers || {}),
      },
      ...(isHttps && !options.verifySsl ? { rejectUnauthorized: false } : {}),
      timeout: options.timeout || 12000,
    };

    const req = lib.request(reqOpts, (res) => {
      let body = '';
      res.on('data', c => { body += c; });
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });

    req.on('timeout', () => { req.destroy(); reject(new Error('Request timed out')); });
    req.on('error',   reject);
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
  try {
    const { rows } = await db.query('SELECT * FROM endpoint_central_config WHERE id = 1');
    return rows[0] || DEFAULT_CONFIG;
  } catch (e) {
    if (e.code === '42P01' || e.code === '42703') return DEFAULT_CONFIG;
    throw e;
  }
}

async function saveConfig({ server_url, customer_id, api_key, api_path, verify_ssl }, updatedBy) {
  try {
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
  } catch (e) {
    if (e.code === '42P01' || e.code === '42703') {
      const err = new Error('Database schema not ready — restart the backend to apply schema updates');
      err.status = 503;
      throw err;
    }
    throw e;
  }
}

// ---------------------------------------------------------------------------
// Response extraction — handles different response shapes across ME EC versions
// ---------------------------------------------------------------------------

function extractComputers(json) {
  // v10.x:           { data: { computers: [...] } }
  // v11 patch API:   { data: { allsystemsdetail: [...] } }
  // older DC:        { message_response: { computer: [...] } }
  // some versions:   { computers: [...] } or { data: { computerdetails: [...] } }
  const candidates = [
    json?.data?.computers,
    json?.data?.allsystemsdetail,
    json?.data?.computerdetails,
    json?.message_response?.computer,
    json?.computers,
    json?.data?.systems,
    json?.systems,
  ];
  for (const c of candidates) {
    if (Array.isArray(c)) return c;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Data normalisation — field names vary across ME EC versions
// ---------------------------------------------------------------------------

function normalizeComputer(c) {
  // agent_status: 0 = Online/Live, 1 = Offline/Dead (ME EC convention)
  // managed_status: 0 = Not Managed, 1 = Managed
  return {
    resource_id:    c.resource_id    ?? c.RESOURCE_ID    ?? c.resourceid    ?? null,
    computer_name:  c.computername   ?? c.COMPUTERNAME   ?? c.computer_name ?? c.COMPUTER_NAME  ?? '—',
    domain:         c.domain         ?? c.DOMAIN         ?? '—',
    ip_address:     c.ipaddress      ?? c.IP_ADDRESS     ?? c.ip_address    ?? c.IPADDRESS      ?? '—',
    os_name:        c.osname         ?? c.OS_NAME        ?? c.osName        ?? c.os_name        ?? '—',
    os_platform:    c.osplatform     ?? c.OS_PLATFORM    ?? null,
    agent_version:  c.agentversion   ?? c.AGENT_VERSION  ?? c.agent_version ?? c.AGENTVERSION   ?? '—',
    managed_status: c.managed_status ?? c.MANAGED_STATUS ?? c.managedstatus ?? 1,
    agent_status:   c.agent_status   ?? c.AGENT_STATUS   ?? c.agentstatus   ?? 1,
    last_sync:      c.lastsync       ?? c.LAST_SYNC      ?? c.last_sync     ?? c.LASTSYNC       ?? null,
    office:         c.resourceoffice ?? c.RESOURCE_OFFICE?? c.office        ?? '—',
    resource_type:  c.resourcetype   ?? c.RESOURCE_TYPE  ?? 0,
  };
}

// ---------------------------------------------------------------------------
// Authentication strategies
// ---------------------------------------------------------------------------

// Build the two auth strategies to try for a given path
function authStrategies(serverUrl, path, apiKey, customerId) {
  const base = serverUrl.replace(/\/$/, '');
  return [
    {
      // Strategy 1: API key in query parameter (older/legacy)
      label: 'query-param',
      url:   `${base}${path}?apikey=${encodeURIComponent(apiKey)}&customerid=${encodeURIComponent(customerId || '1')}`,
      headers: {},
    },
    {
      // Strategy 2: API key in Authorization header (newer v11+)
      label: 'auth-header',
      url:   `${base}${path}?customerid=${encodeURIComponent(customerId || '1')}`,
      headers: { 'Authorization': `Authtoken ${apiKey}` },
    },
    {
      // Strategy 3: Header auth without customerid (some single-tenant setups)
      label: 'auth-header-no-cid',
      url:   `${base}${path}`,
      headers: { 'Authorization': `Authtoken ${apiKey}` },
    },
  ];
}

// Try one path with all auth strategies. Returns { computers, path, authLabel } or null.
async function tryPath(serverUrl, path, apiKey, customerId, verifySsl) {
  for (const strat of authStrategies(serverUrl, path, apiKey, customerId)) {
    try {
      const { status, body } = await httpRequest(strat.url, {
        verifySsl,
        headers: strat.headers,
        timeout: 10000,
      });

      if (status >= 200 && status < 300) {
        let json;
        try { json = JSON.parse(body); } catch { continue; }
        const computers = extractComputers(json);
        if (computers !== null) {
          return { computers, path, authLabel: strat.label };
        }
        // 200 but unrecognised structure — keep trying other auth methods
        continue;
      }

      // Hard auth failure — no point trying more auth methods for this path
      if (status === 401 || status === 403) break;

      // 404 or IAM error on this path — try next auth method (might be auth-related)
      // unless it's a clear server error
      if (status >= 500) break;

    } catch { /* connection error — try next */ }
  }
  return null;
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
  const err = new Error(
    `Could not retrieve agents from Endpoint Central. Tried paths: ${tried}. ` +
    'Check the Server URL, verify the API key is valid, or try clearing the API Path to auto-detect.'
  );
  err.status = 502;
  throw err;
}

async function testConnection() {
  const config = await getConfig();

  if (!config.server_url || !config.api_key) {
    return { success: false, error: 'Server URL and API Key are required' };
  }

  const paths = config.api_path ? [config.api_path] : KNOWN_PATHS;
  const tried = [];

  for (const path of paths) {
    // Try all auth strategies for this path so we can report the exact failure
    for (const strat of authStrategies(config.server_url, path, config.api_key, config.customer_id)) {
      try {
        const { status, body } = await httpRequest(strat.url, {
          verifySsl: config.verify_ssl,
          headers:   strat.headers,
          timeout:   10000,
        });

        if (status >= 200 && status < 300) {
          let json;
          try { json = JSON.parse(body); } catch {
            tried.push({ path, auth: strat.label, status, note: 'non-JSON response' });
            break; // wrong path, try next
          }
          const computers = extractComputers(json);
          if (computers !== null) {
            return {
              success:      true,
              message:      `Connected — ${computers.length} endpoint(s) found`,
              working_path: path,
              auth_method:  strat.label,
            };
          }
          tried.push({ path, auth: strat.label, status, note: 'unrecognised response shape' });
          continue;
        }

        // Parse the error body for a useful message
        let detail = `HTTP ${status}`;
        try {
          const j = JSON.parse(body);
          detail = j.errorMsg || j.message || j.error || detail;
        } catch { /* ignore */ }

        tried.push({ path, auth: strat.label, status, note: detail });

        if (status === 401 || status === 403) break; // wrong credentials — skip remaining auth methods

      } catch (e) {
        tried.push({ path, auth: strat.label, status: 0, note: e.message });
        break; // connection error — skip remaining auth methods for this path
      }
    }
  }

  // Build a concise error summary
  const summary = tried.map(t => `${t.path} [${t.auth}] → ${t.note}`).join('\n');
  return {
    success: false,
    error:   'Could not connect to Endpoint Central. Results per path:',
    detail:  summary,
  };
}

module.exports = { getConfig, saveConfig, fetchAgents, testConnection, KNOWN_PATHS };
