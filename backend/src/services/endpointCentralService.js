/**
 * endpointCentralService.js
 * --------------------------
 * Connects to ManageEngine Endpoint Central (formerly Desktop Central) REST API.
 *
 * Auth methods tried automatically:
 *   1. Query param:  ?apikey=<KEY>&customerid=<ID>       (older versions)
 *   2. Auth header:  Authorization: Authtoken <KEY>      (v11+ versions)
 *   3. Header only:  Authorization: Authtoken <KEY>      (no customerid)
 *
 * Common IAM0027 cause: API key was generated without URL scope permissions.
 * Fix in ME EC: Admin → API Explorer → (re)generate key → select modules.
 */

const https = require('https');
const http  = require('http');
const db    = require('../config/db');

// ---------------------------------------------------------------------------
// Known API paths — tested across multiple ME EC versions
// ---------------------------------------------------------------------------

const KNOWN_PATHS = [
  '/api/1.4/computers',
  '/api/1.4/patch/allsystems',
  '/api/1.4/inventory/computers',
  '/api/1.4/patch/systems/allsystems',
  '/dcapi/rd/computers',
  '/api/1.3/computers',
  '/api/1.4/computers/filter',
  '/api/1.4/inventory/managedendpoints',
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
        'Accept':       'application/json',
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

    req.on('timeout', () => { req.destroy(); reject(new Error('Connection timed out')); });
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
  const candidates = [
    json?.data?.computers,
    json?.data?.allsystemsdetail,
    json?.data?.computerdetails,
    json?.data?.systems,
    json?.data?.managedendpoints,
    json?.message_response?.computer,
    json?.computers,
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
  return {
    resource_id:    c.resource_id    ?? c.RESOURCE_ID    ?? c.resourceid    ?? null,
    computer_name:  c.computername   ?? c.COMPUTERNAME   ?? c.computer_name ?? c.COMPUTER_NAME  ?? '—',
    domain:         c.domain         ?? c.DOMAIN         ?? '—',
    ip_address:     c.ipaddress      ?? c.IP_ADDRESS     ?? c.ip_address    ?? c.IPADDRESS      ?? '—',
    os_name:        c.osname         ?? c.OS_NAME        ?? c.osName        ?? c.os_name        ?? '—',
    os_platform:    c.osplatform     ?? c.OS_PLATFORM    ?? null,
    agent_version:  c.agentversion   ?? c.AGENT_VERSION  ?? c.agent_version ?? c.AGENTVERSION   ?? '—',
    managed_status: c.managed_status ?? c.MANAGED_STATUS ?? c.managedstatus ?? 1,
    // agent_status: 0 = Online/Live, 1 = Offline/Dead
    agent_status:   c.agent_status   ?? c.AGENT_STATUS   ?? c.agentstatus   ?? 1,
    last_sync:      c.lastsync       ?? c.LAST_SYNC      ?? c.last_sync     ?? c.LASTSYNC       ?? null,
    office:         c.resourceoffice ?? c.RESOURCE_OFFICE ?? c.office       ?? '—',
    resource_type:  c.resourcetype   ?? c.RESOURCE_TYPE  ?? 0,
  };
}

// ---------------------------------------------------------------------------
// Authentication strategies to try per path
// ---------------------------------------------------------------------------

function authStrategies(base, path, apiKey, customerId) {
  const cid = encodeURIComponent(customerId || '1');
  const key = encodeURIComponent(apiKey);
  return [
    {
      label:   'query-param',
      url:     `${base}${path}?apikey=${key}&customerid=${cid}`,
      headers: {},
    },
    {
      label:   'auth-header',
      url:     `${base}${path}?customerid=${cid}`,
      headers: { 'Authorization': `Authtoken ${apiKey}` },
    },
    {
      label:   'auth-header-no-cid',
      url:     `${base}${path}`,
      headers: { 'Authorization': `Authtoken ${apiKey}` },
    },
  ];
}

// Parse the error detail out of an ME EC error JSON body
function parseErrorBody(body) {
  try {
    const j = JSON.parse(body);
    return { code: j.errorCode || j.error_code, msg: j.errorMsg || j.message || j.error || body.slice(0, 120) };
  } catch {
    return { code: null, msg: body.slice(0, 120) };
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

  const base  = config.server_url.replace(/\/$/, '');
  const paths = config.api_path ? [config.api_path] : KNOWN_PATHS;

  for (const path of paths) {
    for (const strat of authStrategies(base, path, config.api_key, config.customer_id)) {
      try {
        const { status, body } = await httpRequest(strat.url, {
          verifySsl: config.verify_ssl,
          headers:   strat.headers,
        });
        if (status >= 200 && status < 300) {
          let json;
          try { json = JSON.parse(body); } catch { continue; }
          const computers = extractComputers(json);
          if (computers !== null) return computers.map(normalizeComputer);
        }
        if (status === 401 || status === 403) break; // auth failure — skip other auth methods
      } catch { /* connection error — try next */ }
    }
  }

  const err = new Error(
    'Could not retrieve agents from Endpoint Central. ' +
    'Check the Server URL and API Key, or use Test Connection for a detailed diagnosis.'
  );
  err.status = 502;
  throw err;
}

async function testConnection() {
  const config = await getConfig();

  if (!config.server_url || !config.api_key) {
    return { success: false, error: 'Server URL and API Key are required' };
  }

  const base = config.server_url.replace(/\/$/, '');

  // Always try ALL known paths during test, plus any custom configured path first
  const customPath = config.api_path && !KNOWN_PATHS.includes(config.api_path) ? config.api_path : null;
  const paths = customPath ? [customPath, ...KNOWN_PATHS] : KNOWN_PATHS;

  const tried = [];
  let iamErrorCount = 0;

  for (const path of paths) {
    for (const strat of authStrategies(base, path, config.api_key, config.customer_id)) {
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
            break;
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

        const { code, msg } = parseErrorBody(body);
        if (code === 'IAM0027') iamErrorCount++;
        tried.push({ path, auth: strat.label, status, note: msg });

        if (status === 401 || status === 403) break; // wrong credentials — skip remaining auth methods
      } catch (e) {
        tried.push({ path, auth: strat.label, status: 0, note: e.message });
        break; // connection error — skip remaining auth methods
      }
    }
  }

  // Build diagnostic summary (group by path to keep it readable)
  const byPath = {};
  for (const t of tried) {
    if (!byPath[t.path]) byPath[t.path] = [];
    byPath[t.path].push(`[${t.auth}] HTTP ${t.status || 'ERR'}: ${t.note}`);
  }
  const detail = Object.entries(byPath)
    .map(([path, results]) => `${path}\n  ${results.join('\n  ')}`)
    .join('\n');

  // Detect the IAM0027 / URL-not-allowed pattern and give specific guidance
  const allIam = iamErrorCount > 0 && iamErrorCount >= tried.length * 0.6;
  const guidance = allIam
    ? '\n\n⚠ IAM0027 errors indicate your API key has no endpoint permissions.\n' +
      'Fix in ME EC: Admin → API Explorer → generate/edit the API key → enable module access (Computers / Patch Management).'
    : '';

  return {
    success: false,
    error:   'Could not connect to Endpoint Central:',
    detail:  detail + guidance,
  };
}

module.exports = { getConfig, saveConfig, fetchAgents, testConnection, KNOWN_PATHS };
