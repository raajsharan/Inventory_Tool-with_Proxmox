/**
 * endpointCentralService.js
 * --------------------------
 * Connects to ManageEngine Endpoint Central (formerly Desktop Central) REST API.
 * Reads computer / agent inventory using an API key (no session login required).
 * API: GET /api/1.4/computers?apikey=<key>&customerid=<id>
 */

const https = require('https');
const http  = require('http');
const db    = require('../config/db');

// ---------------------------------------------------------------------------
// Low-level HTTP helper (follows the proxmoxService pattern)
// ---------------------------------------------------------------------------

function httpRequest(urlStr, options = {}) {
  return new Promise((resolve, reject) => {
    const url    = new URL(urlStr);
    const isHttps = url.protocol === 'https:';
    const lib    = isHttps ? https : http;

    const reqOpts = {
      hostname: url.hostname,
      port:     url.port || (isHttps ? 443 : 80),
      path:     url.pathname + url.search,
      method:   options.method || 'GET',
      headers:  {
        'Content-Type': 'application/json',
        ...(options.headers || {}),
      },
      ...(isHttps && !options.verifySsl
        ? { rejectUnauthorized: false }
        : {}
      ),
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
  verify_ssl:  false,
};

async function getConfig() {
  const { rows } = await db.query('SELECT * FROM endpoint_central_config WHERE id = 1');
  return rows[0] || DEFAULT_CONFIG;
}

async function saveConfig({ server_url, customer_id, api_key, verify_ssl }, updatedBy) {
  await db.query(`
    INSERT INTO endpoint_central_config (id, server_url, customer_id, api_key, verify_ssl, updated_by, updated_at)
    VALUES (1, $1, $2, $3, $4, $5, NOW())
    ON CONFLICT (id) DO UPDATE SET
      server_url  = EXCLUDED.server_url,
      customer_id = EXCLUDED.customer_id,
      api_key     = EXCLUDED.api_key,
      verify_ssl  = EXCLUDED.verify_ssl,
      updated_by  = EXCLUDED.updated_by,
      updated_at  = NOW()
  `, [server_url || '', customer_id || '1', api_key || '', !!verify_ssl, updatedBy || null]);
}

// ---------------------------------------------------------------------------
// Data normalisation — ME EC API field names vary slightly across versions
// ---------------------------------------------------------------------------

function normalizeComputer(c) {
  return {
    resource_id:   c.resource_id   ?? c.RESOURCE_ID    ?? c.resourceid   ?? null,
    computer_name: c.computername  ?? c.COMPUTERNAME   ?? c.computer_name ?? '—',
    domain:        c.domain        ?? c.DOMAIN         ?? '—',
    ip_address:    c.ipaddress     ?? c.IP_ADDRESS     ?? c.ip_address   ?? '—',
    os_name:       c.osname        ?? c.OS_NAME        ?? c.os_name      ?? '—',
    os_platform:   c.osplatform    ?? c.OS_PLATFORM    ?? null,
    agent_version: c.agentversion  ?? c.AGENT_VERSION  ?? c.agent_version ?? '—',
    // managed_status: 0 = Not Managed, 1 = Managed
    managed_status: c.managed_status ?? c.MANAGED_STATUS ?? 1,
    // agent_status: 0 = Online/Active, 1 = Offline/Inactive
    agent_status:  c.agent_status  ?? c.AGENT_STATUS  ?? 1,
    last_sync:     c.lastsync      ?? c.LAST_SYNC      ?? c.last_sync    ?? null,
    office:        c.resourceoffice?? c.RESOURCE_OFFICE?? c.office       ?? '—',
    resource_type: c.resourcetype  ?? c.RESOURCE_TYPE  ?? 0,
  };
}

// ---------------------------------------------------------------------------
// API calls
// ---------------------------------------------------------------------------

function buildApiUrl(base, customerId, apiKey, path = '/api/1.4/computers') {
  const clean = base.replace(/\/$/, '');
  return `${clean}${path}?apikey=${encodeURIComponent(apiKey)}&customerid=${encodeURIComponent(customerId || '1')}`;
}

async function fetchAgents() {
  const config = await getConfig();

  if (!config.server_url || !config.api_key) {
    const err = new Error('Endpoint Central is not configured — set Server URL and API Key first');
    err.status = 400;
    throw err;
  }

  const url = buildApiUrl(config.server_url, config.customer_id, config.api_key);
  const { status, body } = await httpRequest(url, { verifySsl: config.verify_ssl });

  if (status < 200 || status >= 300) {
    throw new Error(`Endpoint Central returned HTTP ${status}: ${body.slice(0, 300)}`);
  }

  let json;
  try { json = JSON.parse(body); } catch { throw new Error('Endpoint Central returned non-JSON response'); }

  // Response shape varies by version:
  //   v10.x  → { data: { computers: [...] } }
  //   older  → { message_response: { computer: [...] } }
  //   some   → { computers: [...] }
  const computers =
    json?.data?.computers ??
    json?.data?.computerdetails ??
    json?.message_response?.computer ??
    json?.computers ??
    [];

  return computers.map(normalizeComputer);
}

async function testConnection() {
  const config = await getConfig();

  if (!config.server_url || !config.api_key) {
    return { success: false, error: 'Server URL and API Key are required' };
  }

  try {
    const url = buildApiUrl(config.server_url, config.customer_id, config.api_key);
    const { status, body } = await httpRequest(url, { verifySsl: config.verify_ssl });

    if (status < 200 || status >= 300) {
      return { success: false, error: `HTTP ${status}: ${body.slice(0, 200)}` };
    }

    let json;
    try { json = JSON.parse(body); } catch {
      return { success: false, error: 'Server responded but returned non-JSON data — check the Server URL' };
    }

    const computers =
      json?.data?.computers ??
      json?.data?.computerdetails ??
      json?.message_response?.computer ??
      json?.computers ??
      [];

    return { success: true, message: `Connected — ${computers.length} endpoint(s) found` };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

module.exports = { getConfig, saveConfig, fetchAgents, testConnection };
