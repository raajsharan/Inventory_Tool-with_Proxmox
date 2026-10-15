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

const https   = require('https');
const http    = require('http');
const db      = require('../config/db');
const crypto  = require('../utils/crypto');

// ---------------------------------------------------------------------------
// Known API paths — tested across multiple ME EC versions
// ---------------------------------------------------------------------------

const KNOWN_PATHS = [
  // Inventory scan details — tried first: this is the only endpoint we have
  // confirmed field names for (live_status/installation_status/scan_status,
  // per ME EC's own API Explorer docs). som/computers may use different,
  // unconfirmed field names, which silently defaults every row to
  // Offline/Managed if tried first.
  '/api/1.4/inventory/scancomputers',
  // Official documented paths (ME EC 10.x / Endpoint Central)
  '/api/1.4/som/computers',            // Systems of Management — primary documented endpoint
  '/api/1.4/inventory/computers',      // Inventory module computers
  '/api/1.4/inventory/compdetailssummary', // Computer detail summary
  // Patch management paths (older / alternate)
  '/api/1.4/patch/allsystems',
  '/api/1.4/patch/systems/allsystems',
  // Legacy Desktop Central paths
  '/api/1.4/computers',
  '/api/1.3/computers',
  '/api/1.4/computers/filter',
  '/api/1.4/inventory/managedendpoints',
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
// HTTP POST helper (for credential auth endpoints)
// ---------------------------------------------------------------------------

function httpPost(urlStr, body, options = {}) {
  return new Promise((resolve, reject) => {
    const url     = new URL(urlStr);
    const isHttps = url.protocol === 'https:';
    const lib     = isHttps ? https : http;
    const payload = JSON.stringify(body);

    const reqOpts = {
      hostname: url.hostname,
      port:     url.port || (isHttps ? 443 : 80),
      path:     url.pathname + url.search,
      method:   'POST',
      headers:  {
        'Content-Type':   'application/json',
        'Accept':         'application/json',
        'Content-Length': Buffer.byteLength(payload),
        ...(options.headers || {}),
      },
      ...(isHttps && !options.verifySsl ? { rejectUnauthorized: false } : {}),
      timeout: options.timeout || 15000,
    };

    const req = lib.request(reqOpts, (res) => {
      let data = '';
      res.on('data', c => { data += c; });
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });

    req.on('timeout', () => { req.destroy(); reject(new Error('Connection timed out')); });
    req.on('error',   reject);
    req.write(payload);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Credential-based authentication (username + password, with optional 2FA)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Auth response helpers — ME EC wraps auth data inside message_response
// ---------------------------------------------------------------------------

// Flatten both top-level and message_response fields into a single lookup object.
// ME EC versions differ: some put auth_token at root, others nest it.
function flattenAuthResponse(json) {
  const r = json?.message_response ?? json?.messageResponse ?? {};
  return { ...r, ...json }; // root keys win over nested (so top-level auth_token is preferred)
}

function pickAuthToken(flat) {
  return flat.auth_token   ?? flat.authToken   ?? flat.token
      ?? flat.AUTH_TOKEN   ?? flat.AuthToken   ?? null;
}

function pickUniqueUserId(flat) {
  return flat.unique_userID ?? flat.unique_userid ?? flat.uniqueUserID
      ?? flat.user_id       ?? flat.userId        ?? flat.userID
      ?? flat.UNIQUE_USERID ?? null;
}

function pickOtpRequired(flat) {
  const v = flat.OTP_Validation_Required ?? flat.otp_validation_required
         ?? flat.OTPValidationRequired   ?? flat.otpValidationRequired;
  return v === true || v === 'true' || v === 1;
}

function pickAuthError(flat, status) {
  return flat.error_description ?? flat.error_msg  ?? flat.errorDescription
      ?? flat.message           ?? flat.error       ?? `HTTP ${status}`;
}

// Step 1: POST username + base64(password) to ME EC auth endpoint.
// Returns { otp_required: false, auth_token } on direct success, or
//         { otp_required: true,  unique_user_id } when 2FA is enabled.
async function loginWithCredentials({ serverUrl, username, password, customerId, verifySsl }) {
  const base = serverUrl.replace(/\/$/, '');
  const url  = `${base}/api/1.4/desktop/authentication`;

  const payload = {
    username,
    password:  Buffer.from(password).toString('base64'),
    auth_type: 'local_authentication',
  };
  if (customerId && customerId !== '1') {
    payload.customerid = customerId;
  }

  let status, body;
  try {
    ({ status, body } = await httpPost(url, payload, { verifySsl, timeout: 15000 }));
  } catch (e) {
    const err = new Error(`Could not reach Endpoint Central: ${e.message}`);
    err.status = 502;
    throw err;
  }

  let json;
  try { json = JSON.parse(body); } catch {
    const err = new Error(`Invalid response from Endpoint Central (raw: ${body.slice(0, 200)})`);
    err.status = 502;
    throw err;
  }

  const flat = flattenAuthResponse(json);

  // Detect error response (HTTP error status OR ME EC error body)
  if (status >= 400 || flat.status === 'error' || flat.message_type === 'failure'
      || flat.message_type === 'error') {
    const msg = pickAuthError(flat, status);
    const err = new Error(`Authentication failed: ${msg}`);
    err.status = status >= 400 ? status : 401;
    throw err;
  }

  // 2FA required — server returns unique_userID to use in OTP step
  if (pickOtpRequired(flat)) {
    const uniqueUserId = pickUniqueUserId(flat);
    if (!uniqueUserId) {
      // Include raw response to aid debugging
      const err = new Error(`Server requires OTP but did not return unique_userID. Response: ${body.slice(0, 400)}`);
      err.status = 502;
      throw err;
    }
    return { otp_required: true, unique_user_id: String(uniqueUserId) };
  }

  // Direct auth success — token in the response
  const authToken = pickAuthToken(flat);
  if (authToken) {
    return { otp_required: false, auth_token: String(authToken) };
  }

  // Include raw response body so admin can diagnose the unexpected shape
  const err = new Error(`Endpoint Central responded but no auth_token found. Response: ${body.slice(0, 400)}`);
  err.status = 502;
  throw err;
}

// Step 2: Submit the OTP code with the unique_userID returned from step 1.
// Returns { auth_token } on success.
async function validateOtpCode({ serverUrl, unique_user_id, otp, verifySsl }) {
  const base = serverUrl.replace(/\/$/, '');
  const url  = `${base}/api/1.4/desktop/authentication/otpValidate`;

  const payload = { unique_userID: unique_user_id, otp: String(otp) };

  let status, body;
  try {
    ({ status, body } = await httpPost(url, payload, { verifySsl, timeout: 15000 }));
  } catch (e) {
    const err = new Error(`Could not reach Endpoint Central: ${e.message}`);
    err.status = 502;
    throw err;
  }

  let json;
  try { json = JSON.parse(body); } catch {
    const err = new Error(`Invalid response from OTP validation endpoint (raw: ${body.slice(0, 200)})`);
    err.status = 502;
    throw err;
  }

  const flat = flattenAuthResponse(json);

  if (status >= 400 || flat.status === 'error' || flat.message_type === 'failure'
      || flat.message_type === 'error') {
    const msg = pickAuthError(flat, status);
    const err = new Error(`OTP validation failed: ${msg}`);
    err.status = status >= 400 ? status : 401;
    throw err;
  }

  const authToken = pickAuthToken(flat);
  if (!authToken) {
    const err = new Error(`OTP accepted but no auth_token found. Response: ${body.slice(0, 400)}`);
    err.status = 502;
    throw err;
  }

  return { auth_token: String(authToken) };
}

// ---------------------------------------------------------------------------
// Config CRUD
// ---------------------------------------------------------------------------

const DEFAULT_CONFIG = {
  server_url:    '',
  customer_id:   '1',
  api_key:       '',
  api_path:      '',
  verify_ssl:    false,
  auth_mode:     'api_key',
  auth_username: '',
  auth_password: '',
  session_token: '',
};

async function getConfig() {
  try {
    const { rows } = await db.query('SELECT * FROM endpoint_central_config WHERE id = 1');
    const row = rows[0];
    if (!row) return DEFAULT_CONFIG;
    // api_key / auth_password are stored encrypted at rest (AES-256-GCM);
    // decrypt here so all existing callers keep receiving plaintext.
    return {
      ...row,
      api_key:       crypto.decryptSafe(row.api_key),
      auth_password: crypto.decryptSafe(row.auth_password),
    };
  } catch (e) {
    if (e.code === '42P01' || e.code === '42703') return DEFAULT_CONFIG;
    throw e;
  }
}

async function saveConfig({ server_url, customer_id, api_key, api_path, verify_ssl, auth_mode, auth_username, auth_password }, updatedBy) {
  try {
    // Encrypt secrets at rest — mirrors asset_password_encrypted elsewhere
    // in the app. '' is kept as the "no change" sentinel (see CASE below),
    // so only non-empty values are encrypted.
    const encApiKey       = api_key       ? crypto.encrypt(api_key)       : '';
    const encAuthPassword = auth_password ? crypto.encrypt(auth_password) : '';
    await db.query(`
      INSERT INTO endpoint_central_config
        (id, server_url, customer_id, api_key, api_path, verify_ssl,
         auth_mode, auth_username, auth_password, updated_by, updated_at)
      VALUES (1, $1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
      ON CONFLICT (id) DO UPDATE SET
        server_url    = EXCLUDED.server_url,
        customer_id   = EXCLUDED.customer_id,
        api_key       = CASE
          WHEN EXCLUDED.api_key = '' THEN endpoint_central_config.api_key
          ELSE EXCLUDED.api_key
        END,
        api_path      = EXCLUDED.api_path,
        verify_ssl    = EXCLUDED.verify_ssl,
        auth_mode     = EXCLUDED.auth_mode,
        auth_username = EXCLUDED.auth_username,
        auth_password = CASE
          WHEN EXCLUDED.auth_password = '' THEN endpoint_central_config.auth_password
          ELSE EXCLUDED.auth_password
        END,
        updated_by    = EXCLUDED.updated_by,
        updated_at    = NOW()
    `, [
      server_url    || '',
      customer_id   || '1',
      encApiKey,
      api_path      || '',
      !!verify_ssl,
      auth_mode     || 'api_key',
      auth_username || '',
      encAuthPassword,
      updatedBy     || null,
    ]);
  } catch (e) {
    if (e.code === '42P01' || e.code === '42703') {
      const err = new Error('Database schema not ready — restart the backend to apply schema updates');
      err.status = 503;
      throw err;
    }
    throw e;
  }
}

async function saveSessionToken(token) {
  await db.query(
    `UPDATE endpoint_central_config SET session_token = $1, updated_at = NOW() WHERE id = 1`,
    [token || '']
  );
}

// ---------------------------------------------------------------------------
// Response extraction — handles different response shapes across ME EC versions
// ---------------------------------------------------------------------------

// Known JSON key paths to check (tried in order before the recursive fallback)
const EXTRACT_PATHS = [
  // SoM (Systems of Management) module — /api/1.4/som/computers
  ['message_response', 'Computers'],
  ['message_response', 'computers_details'],
  ['message_response', 'SomComputers'],
  // Inventory module
  ['message_response', 'computer'],
  ['message_response', 'computers'],
  ['message_response', 'allsystems'],
  ['message_response', 'allsystemsdetail'],
  ['message_response', 'systems'],
  ['message_response', 'resourcesdata'],
  ['message_response', 'compdetailssummary'],
  ['data', 'computers'],
  ['data', 'Computers'],
  ['data', 'allsystemsdetail'],
  ['data', 'allsystems'],
  ['data', 'computerdetails'],
  ['data', 'systems'],
  ['data', 'managedendpoints'],
  ['data', 'inventory'],
  ['data', 'resourcesdata'],
  // Top-level arrays
  ['computers'],
  ['Computers'],
  ['systems'],
  ['allsystems'],
  ['allsystemsdetail'],
  ['resourcesdata'],
];

// Does an object look like a ME EC computer/endpoint record?
function looksLikeComputer(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return false;
  const up = new Set(Object.keys(obj).map(k => k.toUpperCase()));
  return up.has('COMPUTERNAME')   || up.has('COMPUTER_NAME') || up.has('HOSTNAME')
      || up.has('RESOURCE_ID')    || up.has('RESOURCEID')
      || up.has('IPADDRESS')      || up.has('IP_ADDRESS')
      || up.has('AGENTVERSION')   || up.has('AGENT_VERSION')
      || up.has('MANAGED_STATUS') || up.has('AGENT_STATUS')
      || up.has('COMPUTERID')     || up.has('COMPUTER_ID')    // SoM fields
      || up.has('NETBIOSNAME')    || up.has('NETBIOS_NAME');  // SoM fields
}

// Recursively find the first array whose elements look like computer records
function deepFindComputerArray(obj, depth) {
  if (depth > 5 || !obj || typeof obj !== 'object') return null;
  for (const val of Object.values(obj)) {
    if (Array.isArray(val)) {
      if (val.length === 0 || looksLikeComputer(val[0])) return val;
    } else if (val && typeof val === 'object' && !Array.isArray(val)) {
      const found = deepFindComputerArray(val, depth + 1);
      if (found !== null) return found;
    }
  }
  return null;
}

// Returns null if the response is an ME EC error body (even when HTTP 200)
function meErrorFromJson(json) {
  if (!json || typeof json !== 'object') return null;
  if (json.status === 'error' && json.error_code) {
    return { code: json.error_code, msg: json.error_description || json.status };
  }
  return null;
}

function extractComputers(json) {
  // Bail out early if ME EC returned an error body (HTTP 200 but auth failed)
  if (meErrorFromJson(json)) return null;

  // 1. Try all known key paths first
  for (const path of EXTRACT_PATHS) {
    let val = json;
    for (const k of path) val = val?.[k];
    if (Array.isArray(val)) return val;
  }
  // 2. Recursive fallback — find any array of computer-like objects
  return deepFindComputerArray(json, 0);
}

// ---------------------------------------------------------------------------
// Data normalisation — field names vary across ME EC versions
// ---------------------------------------------------------------------------

// /api/1.4/inventory/scancomputers documents live_status as
// 1 = Live, 2 = Down, 3 = Unknown. Map to the app's agent_status
// convention: 0 = Online, 1 = Offline, 2 = Unknown.
function mapLiveStatus(v) {
  const n = Number(v);
  if (n === 1) return 0;
  if (n === 2) return 1;
  if (n === 3) return 2;
  return null;
}

// Install status codes (documented on both /som/computers as
// agent_install_status and /inventory/scancomputers as installation_status):
// 21 = Yet to install, 22 = Installed, 23 = Uninstalled,
// 24 = Yet to uninstall, 29 = Installation failure.
function rawInstallStatus(c) {
  return c.agent_install_status ?? c.AGENT_INSTALL_STATUS ?? c.agentinstallstatus
      ?? c.installation_status  ?? c.INSTALLATION_STATUS  ?? c.installationstatus;
}

// Map the raw install status code to the app's managed_status convention:
// 0 = Not Managed, 1 = Managed (only a confirmed agent install counts).
function mapInstallStatus(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return n === 22 ? 1 : 0;
}

// scan_status, documented on /inventory/scancomputers: -1 = Not done,
// 0 = failed, 1 = In progress, 2 = success. Distinct from live_status
// (is the agent reachable right now) and installation_status (is the
// agent installed) — this is "did the last inventory scan itself succeed".
function rawScanStatus(c) {
  const v = c.scan_status ?? c.SCAN_STATUS ?? c.scanstatus ?? c.SCANSTATUS;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// /dcapi endpoints return timestamps as epoch milliseconds (as strings);
// older endpoints return display strings, which pass through untouched.
function toIso(v) {
  if (v == null) return v;
  if (/^\d{12,}$/.test(String(v))) return new Date(Number(v)).toISOString();
  return v;
}

function normalizeComputer(c) {
  const installStatusRaw = rawInstallStatus(c);
  const installStatusNum = Number(installStatusRaw);
  return {
    resource_id:    c.resource_id    ?? c.RESOURCE_ID    ?? c.resourceid    ?? c.computer_id   ?? c.COMPUTER_ID   ?? null,
    computer_name:  c.computername   ?? c.COMPUTERNAME   ?? c.computer_name ?? c.COMPUTER_NAME
                 ?? c.netbiosname    ?? c.NETBIOSNAME    ?? c.netbios_name  ?? c.NETBIOS_NAME
                 ?? c.resource_name  ?? '—',   // resource_name: /dcapi scanComputers
    domain:         c.domain         ?? c.DOMAIN         ?? c.domain_name   ?? c.DOMAIN_NAME
                 ?? c.domain_netbios_name ?? '—',
    ip_address:     c.ipaddress      ?? c.IP_ADDRESS     ?? c.ip_address    ?? c.IPADDRESS
                 ?? c.client_ip      ?? c.CLIENT_IP      ?? '—',
    os_name:        c.osname         ?? c.OS_NAME        ?? c.osName        ?? c.os_name
                 ?? c.os             ?? c.OS             ?? c.operatingsystem ?? '—',
    os_platform:    c.osplatform     ?? c.OS_PLATFORM    ?? null,
    agent_version:  c.agentversion   ?? c.AGENT_VERSION  ?? c.agent_version ?? c.AGENTVERSION  ?? '—',
    // managed_status: 0 = Not Managed, 1 = Managed. Prefer the documented
    // agent_install_status (som/computers) / installation_status
    // (scancomputers) fields over older guessed names.
    managed_status: mapInstallStatus(installStatusRaw)
                  ?? c.managed_status ?? c.MANAGED_STATUS ?? c.managedstatus ?? 1,
    // Raw install status code (21/22/23/24/29) for the Installation Status
    // page, which needs the granular state rather than the collapsed
    // managed/not-managed binary above.
    agent_install_status: Number.isFinite(installStatusNum) ? installStatusNum : null,
    // agent_status: 0 = Online, 1 = Offline, 2 = Unknown. Prefer the
    // documented live_status field (scancomputers API) over older guessed names.
    // Default to 2 (Unknown) rather than 1 (Offline) when no live-status field
    // is present at all — the source endpoint not reporting liveness is not
    // the same fact as every endpoint being confirmed offline, and defaulting
    // to Offline was masking that distinction (every row showed Offline with
    // 0 Online even though ME EC's own console shows agents as live).
    agent_status:   mapLiveStatus(c.live_status ?? c.LIVE_STATUS ?? c.livestatus ?? c.computer_live_status)
                  ?? c.agent_status ?? c.AGENT_STATUS ?? c.agentstatus ?? 2,
    // scan_status: -1 = Not done, 0 = failed, 1 = In progress, 2 = success.
    scan_status:    rawScanStatus(c),
    last_sync:      toIso(c.agent_last_contact_time ?? c.lastsync ?? c.LAST_SYNC      ?? c.last_sync     ?? c.LASTSYNC
                 ?? c.last_contact   ?? c.LAST_CONTACT   ?? c.last_scan_time ?? c.LAST_SCAN_TIME
                 ?? c.lastscantime   ?? c.last_successful_scan ?? null),
    office:         c.resourceoffice ?? c.RESOURCE_OFFICE ?? c.office       ?? c.site ?? c.SITE
                 ?? c.branch_office_name
                 ?? c.location       ?? c.LOCATION        ?? '—',
    resource_type:  c.resourcetype   ?? c.RESOURCE_TYPE  ?? 0,
    // Fields below are best-effort — ME EC field names vary by endpoint/version
    // and haven't been confirmed against a live /inventory/scancomputers
    // response yet. If any render as "—" in the UI, capture a sample JSON
    // response and add the real key names here.
    logged_on_users:  c.user_name    ?? c.USER_NAME      ?? c.loggedonuser  ?? c.LOGGED_ON_USER
                   ?? c.logged_on_user ?? c.LOGGED_ON_USERS ?? c.loggedonusers
                   ?? c.current_logged_users ?? c.currently_logged_user ?? '—',
    service_pack:     c.service_pack ?? c.SERVICE_PACK   ?? c.servicepack  ?? c.SERVICEPACK ?? '—',
    os_version:       c.os_version   ?? c.OS_VERSION     ?? c.osversion    ?? c.OSVERSION
                   ?? c.os_build     ?? c.build_number   ?? c.osbuildnumber ?? '—',
    os_license_status: c.os_license_status ?? c.OS_LICENSE_STATUS ?? c.oslicensestatus
                     ?? c.license_status   ?? c.LICENSE_STATUS   ?? c.activation_status
                     ?? c.ACTIVATION_STATUS ?? '—',
    assigned_to:      c.assigned_to  ?? c.ASSIGNED_TO    ?? c.assignedto   ?? c.ASSIGNEDTO
                   ?? c.resource_user ?? c.RESOURCE_USER ?? c.primary_user ?? c.PRIMARY_USER ?? '—',
  };
}

// ---------------------------------------------------------------------------
// Authentication strategies to try per path
// ---------------------------------------------------------------------------

// ME EC paginates list endpoints (default page size ~25). Request a page
// limit comfortably above real-world endpoint counts so a single request
// returns everything instead of just the first page.
const PAGE_LIMIT = 850;

function authStrategies(base, path, apiKey, customerId) {
  const cid = encodeURIComponent(customerId || '1');
  const key = encodeURIComponent(apiKey);
  return [
    // ME EC v11+ API key via Authorization header (most common for newer versions)
    {
      label:   'authtoken-header',
      url:     `${base}${path}?customerid=${cid}&pagelimit=${PAGE_LIMIT}`,
      headers: { 'Authorization': `Authtoken ${apiKey}` },
    },
    // Bare key, no prefix — some ME EC instances only accept the raw key value
    {
      label:   'raw-key-header',
      url:     `${base}${path}?customerid=${cid}&pagelimit=${PAGE_LIMIT}`,
      headers: { 'Authorization': apiKey },
    },
    // Bearer token (OAuth-style — some ME EC setups require this format)
    {
      label:   'bearer-header',
      url:     `${base}${path}?customerid=${cid}&pagelimit=${PAGE_LIMIT}`,
      headers: { 'Authorization': `Bearer ${apiKey}` },
    },
    // Bearer without customerid
    {
      label:   'bearer-no-cid',
      url:     `${base}${path}?pagelimit=${PAGE_LIMIT}`,
      headers: { 'Authorization': `Bearer ${apiKey}` },
    },
    // Legacy: API key as query parameter (older Desktop Central)
    {
      label:   'query-param',
      url:     `${base}${path}?apikey=${key}&customerid=${cid}&pagelimit=${PAGE_LIMIT}`,
      headers: {},
    },
  ];
}

// Session token strategies — used when auth_mode = 'credentials'
// The token obtained from credential login is sent as a raw Authorization value (no prefix).
function sessionTokenStrategies(base, path, token, customerId) {
  const cid = encodeURIComponent(customerId || '1');
  return [
    // Raw token (no prefix) — standard for credential-obtained tokens
    {
      label:   'session-raw',
      url:     `${base}${path}?customerid=${cid}&pagelimit=${PAGE_LIMIT}`,
      headers: { 'Authorization': token },
    },
    // Also try Authtoken prefix in case the server expects that format
    {
      label:   'session-authtoken',
      url:     `${base}${path}?customerid=${cid}&pagelimit=${PAGE_LIMIT}`,
      headers: { 'Authorization': `Authtoken ${token}` },
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
// Software inventory extraction
// API: GET /api/1.4/inventory/software
// Documented filter params: domainFilter, licensetypefilter, accesstypefilter,
//   compliancestatusfilter
// Documented response fields: sw_type, is_usage_prohibited, compliant_status
// ---------------------------------------------------------------------------

// Paths to try in order — primary + installedsoftware as fallback
const SOFTWARE_PATHS = [
  '/api/1.4/inventory/software',
  '/api/1.4/inventory/installedsoftware',
];

// Known JSON key paths to check (tried before recursive fallback)
const SOFTWARE_EXTRACT_PATHS = [
  // Primary documented endpoint
  ['message_response', 'software'],
  ['message_response', 'Software'],
  ['message_response', 'SoftwareDetails'],
  ['message_response', 'softwareDetails'],
  ['message_response', 'software_list'],
  ['message_response', 'softwares'],
  ['message_response', 'softwarelist'],
  // installedsoftware endpoint
  ['message_response', 'installedsoftware'],
  ['message_response', 'InstalledSoftware'],
  ['message_response', 'installedSoftware'],
  // data-wrapped variants
  ['data', 'software'],
  ['data', 'Software'],
  ['data', 'installedsoftware'],
  ['data', 'softwares'],
  ['data', 'softwarelist'],
  // Top-level arrays
  ['software'],
  ['Software'],
  ['installedsoftware'],
  ['softwares'],
  ['softwarelist'],
];

function looksLikeSoftware(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return false;
  const up = new Set(Object.keys(obj).map(k => k.toUpperCase()));
  return up.has('SOFTWARE_NAME') || up.has('SW_NAME')        || up.has('SOFTWARENAME')
      || up.has('SW_TYPE')       || up.has('SWTYPE')         || up.has('SOFTWARE_TYPE')
      || up.has('INSTALLED_COUNT')  || up.has('INSTALLEDCOUNT')
      || up.has('COMPLIANT_STATUS') || up.has('COMPLIANCE_STATUS')
      || up.has('IS_USAGE_PROHIBITED');
}

function deepFindSoftwareArray(obj, depth) {
  if (depth > 5 || !obj || typeof obj !== 'object') return null;
  for (const val of Object.values(obj)) {
    if (Array.isArray(val)) {
      if (val.length === 0 || looksLikeSoftware(val[0])) return val;
    } else if (val && typeof val === 'object' && !Array.isArray(val)) {
      const found = deepFindSoftwareArray(val, depth + 1);
      if (found !== null) return found;
    }
  }
  return null;
}

function extractSoftware(json) {
  if (meErrorFromJson(json)) return null;
  for (const kpath of SOFTWARE_EXTRACT_PATHS) {
    let val = json;
    for (const k of kpath) val = val?.[k];
    if (Array.isArray(val)) return val;
  }
  return deepFindSoftwareArray(json, 0);
}

function normalizeSoftware(sw) {
  return {
    software_id:   sw.software_id    ?? sw.SOFTWARE_ID    ?? sw.sw_id           ?? null,
    software_name: sw.software_name  ?? sw.SOFTWARE_NAME  ?? sw.sw_name         ?? sw.softwarename
                ?? sw.SoftwareName   ?? sw.SOFTWARENAME   ?? '—',
    software_code: sw.software_code  ?? sw.SOFTWARE_CODE  ?? sw.sw_code         ?? '',
    version:       sw.version        ?? sw.VERSION        ?? sw.sw_version      ?? sw.software_version
                ?? sw.SoftwareVersion ?? '—',
    manufacturer:  sw.manufacturer   ?? sw.MANUFACTURER   ?? sw.vendor          ?? sw.VENDOR
                ?? sw.Publisher      ?? sw.PUBLISHER      ?? '—',
    // sw_type: 0=unidentified, 1=commercial, 2=non-commercial
    sw_type:             sw.sw_type            ?? sw.SW_TYPE            ?? sw.software_type    ?? 0,
    // is_usage_prohibited: 0=not assigned, 1=allowed, 2=prohibited
    is_usage_prohibited: sw.is_usage_prohibited ?? sw.IS_USAGE_PROHIBITED ?? sw.accesstype      ?? 0,
    // compliant_status: -1=not available, 0=under licensed, 1=over licensed, 2=in compliance, 3=expired
    compliant_status:    sw.compliant_status   ?? sw.COMPLIANT_STATUS   ?? sw.compliance_status ?? -1,
    installed_count:     sw.installed_count    ?? sw.INSTALLED_COUNT    ?? sw.installedcount    ?? 0,
    licensed_count:      sw.licensed_count     ?? sw.LICENSED_COUNT     ?? sw.licensecount      ?? 0,
    managed_count:       sw.managed_count      ?? sw.MANAGED_COUNT      ?? 0,
  };
}

// Build a query string to append to a URL that already has '?...' params
function appendFilterQs(url, filters = {}) {
  const parts = [];
  // Documented ME EC filter parameters for /api/1.4/inventory/software
  if (filters.domainFilter != null && filters.domainFilter !== '')
    parts.push(`domainFilter=${encodeURIComponent(filters.domainFilter)}`);
  if (filters.licensetypefilter != null && filters.licensetypefilter !== '')
    parts.push(`licensetypefilter=${encodeURIComponent(filters.licensetypefilter)}`);
  if (filters.accesstypefilter != null && filters.accesstypefilter !== '')
    parts.push(`accesstypefilter=${encodeURIComponent(filters.accesstypefilter)}`);
  if (filters.compliancestatusfilter != null && filters.compliancestatusfilter !== '')
    parts.push(`compliancestatusfilter=${encodeURIComponent(filters.compliancestatusfilter)}`);
  if (!parts.length) return url;
  return url + (url.includes('?') ? '&' : '?') + parts.join('&');
}

async function fetchSoftware(filters = {}) {
  const config = await getConfig();
  const useCredentials = config.auth_mode === 'credentials';

  if (!config.server_url) {
    const err = new Error('Endpoint Central is not configured — set Server URL first');
    err.status = 400;
    throw err;
  }
  if (!useCredentials && !config.api_key) {
    const err = new Error('Endpoint Central is not configured — set an API Key or use credential login');
    err.status = 400;
    throw err;
  }
  if (useCredentials && !config.session_token) {
    const err = new Error('Not authenticated — open Endpoint Central settings and log in with your credentials');
    err.status = 400;
    throw err;
  }

  const base = config.server_url.replace(/\/$/, '');

  const strategies = useCredentials
    ? sessionTokenStrategies
    : authStrategies;
  const stratKey   = useCredentials ? config.session_token : config.api_key;

  for (const swPath of SOFTWARE_PATHS) {
    for (const strat of strategies(base, swPath, stratKey, config.customer_id)) {
      try {
        const url = appendFilterQs(strat.url, filters);
        const { status, body } = await httpRequest(url, {
          verifySsl: config.verify_ssl,
          headers:   strat.headers,
          timeout:   30000, // software list can be large
        });
        if (status >= 200 && status < 300) {
          let json;
          try { json = JSON.parse(body); } catch { continue; }
          const meErr = meErrorFromJson(json);
          if (meErr) continue;
          const software = extractSoftware(json);
          if (software !== null) return software.map(normalizeSoftware);
        }
        if (status === 401 || status === 403) break;
      } catch { /* try next */ }
    }
  }

  const err = new Error(
    'Could not retrieve software list from Endpoint Central. ' +
    'Check the Server URL and API Key, or use Test Connection for a detailed diagnosis.'
  );
  err.status = 502;
  throw err;
}

// ---------------------------------------------------------------------------
// /dcapi + other newer endpoints (shared by the Customer Support team)
// Docs: https://www.manageengine.com/products/desktop-central/help/api/onpremise/api-index.html
//
// Selecting one of these as the API Path switches collection to it:
//   list     — paged computer list; rows are normalised into agents directly
//   resource — per-computer ({resourceID}); the computer list comes from
//              scanComputers and each row is enriched with this endpoint
//   raw      — not computer rows (summaries, reports, groups…); agent
//              collection falls back to auto-detect, data is readable via
//              GET /endpoint-central/explore?path=…
//   action   — state-changing (POST); never called by this tool
// ---------------------------------------------------------------------------

const SCAN_PATH = '/dcapi/inventory/viewData/scanComputers';
const DCAPI_PAGE_LIMIT = 500;
const DCAPI_MAX_PAGES  = 200;
const ENRICH_MAX       = 100; // endpoints are limited to 120 calls/min
const ENRICH_CONCURRENCY = 4;

// '--' is how ME EC renders "empty"
const clean = v => (v == null || v === '--' || v === '') ? undefined : v;
const pick  = obj => Object.fromEntries(Object.entries(obj).filter(([, v]) => clean(v) !== undefined));

function normalizeScanRow(r) {
  return normalizeComputer({ ...r, user_name: clean(r.name) });
}

function normalizePatchSystem(r) {
  return {
    ...normalizeComputer({
      computername:   r.ComputerName,
      domain:         r.Domain,
      ip_address:     r.IpAddress,
      os_name:        r.OperatingSystem,
      os_platform:    r.OsPlatform,
      live_status:    r.ComputerLiveStatus,
      scan_status:    r.ScanStatus,
      last_sync:      r.LastContactTime,
      resourceoffice: r.RemoteOffice,
      user_name:      clean(r.LoggedOnUsers),
      service_pack:   r.ServicePack,
      location:       clean(r.Location),
    }),
    // Patch posture — Health: 0 Unknown, 1 Healthy, 2 Vulnerable, 3 Highly Vulnerable
    patch_health:      Number(r.Health),
    missing_patches:   Number(r.MissingPatches),
    critical_patches:  Number(r.CriticalPatchCount),
    installed_patches: Number(r.InstalledPatches),
    failed_patches:    Number(r.FailedPatches),
    last_boot_time:    clean(r.LastBootTime) ?? null,
    last_patched_time: clean(r.LastPatchedTime) ?? null,
  };
}

const mergeGeneral = g => pick({
  logged_on_users: g.currentLoggedUser, os_license_status: g.licenseStatus,
  domain: g.domainName, last_sync: g.lastSyncTime, last_boot_time: g.lastBootTime,
  mac_address: g.macAddress,
});
const mergeOs = o => pick({
  os_name: o.operatingSystem, os_version: o.osBuildNumber ?? o.osVersion,
  service_pack: o.osServicePack, os_license_type: o.licenseType,
});
const mergeUser = u => pick({ assigned_to: u.userFullName ?? u.userName });
const mergeAsset = a => pick({
  total_software_count: a.totalSoftwaresCount, total_hardware_count: a.totalHardwaresCount,
  prohibited_software_count: a.prohibitedSoftwaresCount, missing_patches: a.missingPatchesCount,
});
const mergeHardware = h => pick({
  computer_model: h.computerModel, computer_manufacturer: h.computerManufacturer,
  ram_memory: h.ramMemory, processor: h.processorNames, service_tag: h.serviceTag,
  warranty_expiry: h.warrantyExpiryDate,
});
const mergeDisk = d => pick({ disk_size: d.diskSize, disk_used_percent: d.diskUsedPercentage });
const mergeSummary = s => ({
  ...mergeGeneral(s.generalSummary || {}), ...mergeOs(s.osSummary || {}),
  ...mergeAsset(s.assetSummary || {}),     ...mergeHardware(s.hardwareSummary || {}),
  ...mergeDisk(s.diskUsageSummary || {}),
});

const J = 'application/json';
const raw = (accept = J, params = []) => ({ kind: 'raw', accept, params });
const res = (accept, merge) => ({ kind: 'resource', accept, merge, params: ['resourceID'] });

const DCAPI = {
  // computer lists
  [SCAN_PATH]:                    { kind: 'list', accept: 'application/InventoryMobileAPI.v1+json', normalize: normalizeScanRow },
  '/dcapi/patch/reports/systems': { kind: 'list', accept: J, normalize: normalizePatchSystem },
  // per-computer detail
  '/dcapi/inventory/computers/{resourceID}/summary':        res('application/computerSummary.v1+json', mergeSummary),
  '/dcapi/inventory/computers/{resourceID}/generalSummary': res('application/computerInfo.v1+json',    mergeGeneral),
  '/dcapi/inventory/computers/{resourceID}/assetSummary':   res('application/assetSummary.v1+json',    mergeAsset),
  '/dcapi/inventory/computers/{resourceID}/osInformation':  res('application/osInformation.v1+json',   mergeOs),
  '/dcapi/inventory/computers/{resourceID}/user':           res('application/userInfo.v1+json',        mergeUser),
  // aggregate / reference data
  '/dcapi/inventory/allsummary':             raw('application/allsummary.v1+json'),
  '/dcapi/inventory/computers/services':     raw('application/services.v1+json'),
  '/dcapi/inventory/computers/groups':       raw('application/groups.v1+json'),
  '/api/1.4/desktop/serverproperties':       raw(J),
  '/sse/api/applications':                   raw(J),
  '/dcapi/patch/reports/systemHealth':       raw(J),
  '/dcapi/som/computers/agentInstallStatus': raw('application/somComputerAgentInstallationStatus.v1+json'),
  '/dcapi/scap/compliance/map/customGroups': raw(J),
  '/dcapi/scap/compliance/map/CGMapDetails': raw(J),
  // custom reports
  '/dcapi/reports/customReports':                          raw('application/allCustomReports.v1+json'),
  '/dcapi/reports/customReports/v2/columns':               raw(J),
  '/dcapi/reports/customReports/availableCharts':          raw(J),
  '/dcapi/reports/customReports/v2/{reportId}':            raw(J, ['reportId']),
  '/dcapi/reports/customReports/formulaColumn/{columnID}': raw(J, ['columnID']),
  // state-changing — registered only so they are recognised and refused
  '/dcapi/som/computers/installAgent': { kind: 'action' },
  '/{CRVIEW_VIEWNAME}.ec':             { kind: 'action' },
};

const ACTION_MSG = 'This endpoint changes state on Endpoint Central (POST) and is not used for data collection — pick a read-only endpoint.';

// ME EC auth header formats differ by version/token type; try each in turn.
async function dcapiGet(config, urlPath, { accept = J, query = {} } = {}) {
  const useCredentials = config.auth_mode === 'credentials';
  const token = useCredentials ? config.session_token : config.api_key;
  const base  = config.server_url.replace(/\/$/, '');
  const qs    = new URLSearchParams(
    Object.entries(query).filter(([, v]) => v != null && v !== '')
  ).toString();
  const url = `${base}${urlPath}${qs ? '?' + qs : ''}`;

  const variants = [['raw', token], ['authtoken', `Authtoken ${token}`], ['bearer', `Bearer ${token}`]];
  let last;
  for (const [label, auth] of variants) {
    let r;
    try {
      r = await httpRequest(url, {
        verifySsl: config.verify_ssl, timeout: 30000,
        headers: { Accept: accept, Authorization: auth },
      });
    } catch (e) {
      const err = new Error(`Could not reach Endpoint Central: ${e.message}`);
      err.status = 502;
      throw err;
    }
    last = { ...r, auth: label };
    if (r.status !== 401 && r.status !== 403) break;
  }

  let json = null;
  try { json = JSON.parse(last.body); } catch { /* non-JSON */ }
  if (last.status < 200 || last.status >= 300) {
    const msg  = json?.error_description || json?.errorMessage || json?.message || last.body.slice(0, 160);
    const code = json?.error_code || json?.errorCode;
    const err  = new Error(`${urlPath} → HTTP ${last.status}${code ? ` (${code})` : ''}: ${msg}`);
    err.status = last.status === 401 || last.status === 403 ? last.status : 502;
    throw err;
  }
  if (json === null) {
    const err = new Error(`${urlPath} returned a non-JSON response`);
    err.status = 502;
    throw err;
  }
  return { json, auth: last.auth };
}

const rowsOf = j => j.messageResponse ?? j.message_response ?? [];

async function fetchPaged(config, path, entry) {
  const rows = [];
  let totalPages = 1;
  for (let page = 1; page <= totalPages && page <= DCAPI_MAX_PAGES; page++) {
    const { json } = await dcapiGet(config, path, {
      accept: entry.accept, query: { page, pageLimit: DCAPI_PAGE_LIMIT },
    });
    const batch = rowsOf(json);
    if (!Array.isArray(batch) || !batch.length) break;
    rows.push(...batch);
    totalPages = Number(json.totalPages) || 1;
  }
  return rows;
}

async function mapLimit(items, limit, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) await fn(items[i++]);
  }));
}

async function fetchDcapiAgents(config, path, entry) {
  if (entry.kind === 'list') {
    const agents = (await fetchPaged(config, path, entry)).map(entry.normalize);
    if (path === SCAN_PATH) return agents;
    // Other lists (e.g. the patch report) carry no agent install status, which
    // the Managed / Staged / Pending category depends on — fill it in from
    // scanComputers, matching on computer name. Best-effort.
    try {
      const scan = (await fetchPaged(config, SCAN_PATH, DCAPI[SCAN_PATH])).map(normalizeScanRow);
      const byName = new Map(scan.map(s => [String(s.computer_name).toLowerCase(), s]));
      for (const a of agents) {
        const s = byName.get(String(a.computer_name).toLowerCase());
        if (!s) continue;
        a.resource_id           ??= s.resource_id;
        a.agent_install_status  = s.agent_install_status;
        a.managed_status        = s.managed_status;
        if (a.agent_version === '—') a.agent_version = s.agent_version;
        if (!a.last_sync) a.last_sync = s.last_sync;
      }
    } catch { /* keep the list as-is */ }
    return agents;
  }
  // resource: base list from scanComputers, enrich each row
  const agents  = (await fetchPaged(config, SCAN_PATH, DCAPI[SCAN_PATH])).map(normalizeScanRow);
  const targets = agents.filter(a => a.resource_id != null).slice(0, ENRICH_MAX);
  await mapLimit(targets, ENRICH_CONCURRENCY, async (a) => {
    try {
      const { json } = await dcapiGet(
        config, path.replace('{resourceID}', encodeURIComponent(a.resource_id)), { accept: entry.accept });
      Object.assign(a, entry.merge(json), { enriched: true });
    } catch { a.enriched = false; }
  });
  return agents;
}

// Read-only passthrough for any supported GET endpoint. `params` fills the
// {templates}; everything else is forwarded as a query string.
async function exploreDcapi(path, params = {}) {
  const entry = DCAPI[path];
  if (!entry) { const e = new Error('Unknown endpoint — not in the supported list'); e.status = 400; throw e; }
  if (entry.kind === 'action') { const e = new Error(ACTION_MSG); e.status = 400; throw e; }

  const config = await getConfig();
  if (!config.server_url) { const e = new Error('Endpoint Central is not configured — set Server URL first'); e.status = 400; throw e; }

  const used = new Set(['path']);
  let urlPath = path;
  for (const p of entry.params || []) {
    if (!params[p]) { const e = new Error(`Query parameter "${p}" is required for this endpoint`); e.status = 400; throw e; }
    urlPath = urlPath.replace(`{${p}}`, encodeURIComponent(params[p]));
    used.add(p);
  }
  const query = Object.fromEntries(Object.entries(params).filter(([k]) => !used.has(k)));
  return (await dcapiGet(config, urlPath, { accept: entry.accept, query })).json;
}

async function testDcapi(config, path, entry) {
  if (entry.kind === 'action') return { success: false, error: ACTION_MSG };
  const needed = (entry.params || []).filter(p => p !== 'resourceID');
  if (needed.length) {
    return {
      success: false,
      error: `This endpoint needs a ${needed.map(p => `{${p}}`).join(', ')} value, so it can't be auto-tested. Use the explore API with ?path=…&${needed[0]}=…`,
    };
  }
  try {
    let json, auth, count = null, sample;
    if (entry.kind === 'list') {
      ({ json, auth } = await dcapiGet(config, path, { accept: entry.accept, query: { page: 1, pageLimit: 1 } }));
      const rows = rowsOf(json);
      count  = Number(json.totalRecords) || rows.length;
      sample = rows[0];
    } else if (entry.kind === 'resource') {
      const scan  = await dcapiGet(config, SCAN_PATH, { accept: DCAPI[SCAN_PATH].accept, query: { page: 1, pageLimit: 1 } });
      const first = rowsOf(scan.json)[0];
      if (!first) return { success: false, error: 'Connected, but no computers are registered to test this per-computer endpoint with' };
      ({ json, auth } = await dcapiGet(
        config, path.replace('{resourceID}', encodeURIComponent(first.resource_id)), { accept: entry.accept }));
      sample = json;
    } else {
      ({ json, auth } = await dcapiGet(config, path, { accept: entry.accept }));
      sample = Array.isArray(json) ? json[0] : json;
    }
    return {
      success: true,
      message: entry.kind === 'list'
        ? `Connected — ${count} endpoint(s) found`
        : entry.kind === 'resource'
          ? 'Connected — per-computer endpoint responded (rows are enriched from it on sync)'
          : 'Connected — endpoint responded. It does not return computer rows, so the agent list falls back to auto-detect. Use the explore API to read it.',
      working_path: path,
      auth_method:  auth,
      sample_fields: sample && typeof sample === 'object' ? Object.keys(sample).sort() : [],
    };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

async function fetchAgentsUntagged() {
  const config = await getConfig();
  const useCredentials = config.auth_mode === 'credentials';

  if (!config.server_url) {
    const err = new Error('Endpoint Central is not configured — set Server URL first');
    err.status = 400;
    throw err;
  }
  if (!useCredentials && !config.api_key) {
    const err = new Error('Endpoint Central is not configured — set an API Key or use credential login');
    err.status = 400;
    throw err;
  }
  if (useCredentials && !config.session_token) {
    const err = new Error('Not authenticated — open Endpoint Central settings and log in with your credentials');
    err.status = 400;
    throw err;
  }

  const dcapiEntry = DCAPI[config.api_path];
  if (dcapiEntry && (dcapiEntry.kind === 'list' || dcapiEntry.kind === 'resource')) {
    return fetchDcapiAgents(config, config.api_path, dcapiEntry);
  }

  const base  = config.server_url.replace(/\/$/, '');
  // raw/action /dcapi selections aren't computer lists — fall back to auto-detect
  const paths = config.api_path && !dcapiEntry ? [config.api_path] : KNOWN_PATHS;

  const strategies = useCredentials ? sessionTokenStrategies : authStrategies;
  const stratKey   = useCredentials ? config.session_token   : config.api_key;

  for (const path of paths) {
    for (const strat of strategies(base, path, stratKey, config.customer_id)) {
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

// ---------------------------------------------------------------------------
// Custom group membership
// No documented API returns "which custom groups is this computer in", so we
// list the server's custom group names (serverproperties) and ask the computer
// list for each one via the customgroupfilter parameter. Best-effort: a group
// whose result is empty, errors, or is the whole fleet (filter not honoured)
// is skipped, and failures never block the agent list. Cached to limit calls.
// ---------------------------------------------------------------------------

const GROUP_CACHE_MS = 10 * 60 * 1000;
let groupCache = { at: 0, key: '', byResource: new Map(), byName: new Map() };

async function loadGroupMembership(config, total) {
  const key = `${config.server_url}|${total}`;
  if (groupCache.key === key && Date.now() - groupCache.at < GROUP_CACHE_MS) return groupCache;

  const byResource = new Map();
  const byName     = new Map();
  const add = (map, k, g) => { if (k == null) return; (map.get(k) || map.set(k, []).get(k)).push(g); };

  const props  = await dcapiGet(config, '/api/1.4/desktop/serverproperties', { accept: J });
  const groups = props.json?.message_response?.serverproperties?.custom_groups || [];

  const queryGroup = async (g) => {
    const { json } = await dcapiGet(config, '/api/1.4/inventory/scancomputers', {
      accept: J, query: { customgroupfilter: g, customerid: config.customer_id || '1', pagelimit: 850 },
    });
    return extractComputers(json);
  };

  // Sentinel: a group that cannot exist must return nothing. If it returns
  // computers, this server ignores customgroupfilter and every group would
  // wrongly list every computer — show no groups rather than wrong ones.
  try {
    const ghost = await queryGroup('__no_such_custom_group__');
    if (ghost && ghost.length) groups.length = 0;
  } catch { groups.length = 0; }

  for (const g of groups) {
    try {
      const rows = await queryGroup(g);
      if (!rows || !rows.length) continue;
      if (rows.length >= total && groups.length > 1) continue; // filter ignored / all-computers group
      for (const c of rows.map(normalizeComputer)) {
        add(byResource, c.resource_id != null ? String(c.resource_id) : null, g);
        add(byName, String(c.computer_name).toLowerCase(), g);
      }
    } catch { /* skip this group */ }
  }
  groupCache = { at: Date.now(), key, byResource, byName };
  return groupCache;
}

async function fetchAgents() {
  const agents = await fetchAgentsUntagged();
  try {
    const config = await getConfig();
    const m = await loadGroupMembership(config, agents.length);
    for (const a of agents) {
      a.custom_groups = (a.resource_id != null && m.byResource.get(String(a.resource_id)))
        || m.byName.get(String(a.computer_name).toLowerCase()) || [];
    }
  } catch { /* groups are optional */ }
  return agents;
}

// ---------------------------------------------------------------------------
// Quick reachability check — network-level only (no auth, no API-path
// guessing) so the admin gets an instant signal on whether the host/port
// is even reachable, before running the slower full testConnection() below.
// ---------------------------------------------------------------------------

async function checkReachability(serverUrl, verifySsl) {
  if (!serverUrl) return { reachable: false, error: 'Server URL is required' };

  const base = serverUrl.trim().replace(/\/$/, '');
  try {
    new URL(base);
  } catch {
    return { reachable: false, error: 'Invalid URL format' };
  }

  try {
    const { status } = await httpRequest(base, { verifySsl, timeout: 5000 });
    return { reachable: true, status };
  } catch (e) {
    return { reachable: false, error: e.message };
  }
}

async function testConnection() {
  const config = await getConfig();
  const useCredentials = config.auth_mode === 'credentials';

  if (!config.server_url) {
    return { success: false, error: 'Server URL is required' };
  }
  if (!useCredentials && !config.api_key) {
    return { success: false, error: 'API Key is required (or switch to credential login and log in first)' };
  }
  if (useCredentials && !config.session_token) {
    return { success: false, error: 'Not logged in — use the Login button in settings to authenticate first' };
  }

  if (DCAPI[config.api_path]) return testDcapi(config, config.api_path, DCAPI[config.api_path]);

  const base = config.server_url.replace(/\/$/, '');

  // Try the configured path first — whether it's a custom path or one of the
  // KNOWN_PATHS entries — so Test Connection validates the admin's actual
  // selection instead of always preferring whichever KNOWN_PATHS entry
  // happens to be tried first. Falls back to the rest of KNOWN_PATHS if the
  // configured path doesn't work.
  const paths = config.api_path
    ? [config.api_path, ...KNOWN_PATHS.filter(p => p !== config.api_path)]
    : KNOWN_PATHS;

  const strategies = useCredentials ? sessionTokenStrategies : authStrategies;
  const stratKey   = useCredentials ? config.session_token   : config.api_key;

  const tried = [];
  let iamErrorCount = 0;

  for (const path of paths) {
    for (const strat of strategies(base, path, stratKey, config.customer_id)) {
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

          // ME EC often returns HTTP 200 even for auth errors — check the body
          const meErr = meErrorFromJson(json);
          if (meErr) {
            const hint = meErr.code === '10002'
              ? `Token invalid/expired (${meErr.code}) — regenerate the API key in ME EC: Admin → API Explorer`
              : `ME EC error ${meErr.code}: ${meErr.msg}`;
            tried.push({ path, auth: strat.label, status, note: hint });
            // Don't break — try the next auth method (Bearer might work where Authtoken doesn't)
            continue;
          }

          const computers = extractComputers(json);
          if (computers !== null) {
            // Surface the raw field names (and live-status value, if any) of
            // one sample record — lets an admin confirm whether this ME EC
            // server's response actually includes a live/agent status field
            // before assuming the mapping in normalizeComputer() is wrong.
            const sample = computers[0] || null;
            const sampleFields = sample ? Object.keys(sample).sort() : [];
            const liveStatusKey = sampleFields.find(k => /^(live[_]?status|agent[_]?status)$/i.test(k));
            return {
              success:      true,
              message:      `Connected — ${computers.length} endpoint(s) found`,
              working_path: path,
              auth_method:  strat.label,
              sample_fields: sampleFields,
              live_status_field: liveStatusKey || null,
              live_status_value: liveStatusKey ? sample[liveStatusKey] : null,
            };
          }
          // Shape unrecognised — show top-level keys and preview for debugging
          const topKeys = Object.keys(json).join(', ');
          const preview = JSON.stringify(json).slice(0, 300);
          tried.push({ path, auth: strat.label, status, note: `200 OK — unknown shape. Keys: [${topKeys}] — ${preview}` });
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

module.exports = {
  getConfig,
  saveConfig,
  saveSessionToken,
  loginWithCredentials,
  validateOtpCode,
  fetchAgents,
  fetchSoftware,
  exploreDcapi,
  DCAPI,
  checkReachability,
  testConnection,
  KNOWN_PATHS,
};
