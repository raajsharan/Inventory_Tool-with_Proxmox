/**
 * ecGroupsService.js
 * -------------------
 * Read-only mirror of ManageEngine Endpoint Central custom groups plus the
 * "staged" (pending approval) computer list.
 *
 * EC allows only 30 calls/min on the group APIs and the staged API, then locks
 * the caller out for 5 minutes, so every call here goes through one shared
 * rolling-window throttle (EC_GROUP_CALLS_PER_MIN, default 25). Groups are
 * copied into Postgres by a background sync and only re-fetched when EC reports
 * a newer modified_on.
 *
 * Only GET endpoints are used — nothing here changes data in EC.
 */

const db = require('../config/db');
const ec = require('./endpointCentralService');

// ---------------------------------------------------------------------------
// Status codes + value cleaning
// ---------------------------------------------------------------------------

const LIVE_STATUS    = { 1: 'Live', 2: 'Down', 3: 'Unknown' };
const INSTALL_STATUS = { 21: 'Yet to install', 22: 'Installed', 23: 'Uninstalled', 24: 'Yet to uninstall', 29: 'Installation failed' };
const OS_PLATFORM    = { 0: 'Unknown', 1: 'Windows', 2: 'Mac', 3: 'Linux' };
const APPROVAL       = { 1: 'Approved', 2: 'Denied', 3: 'Pending' };

// EC renders "empty" as '--'
const nullify = v => (v == null || v === '--' || v === '') ? null : v;
const epochToIso = v => {
  v = nullify(v);
  if (v == null || !/^\d{10,}$/.test(String(v))) return v;
  return new Date(Number(v)).toISOString();
};
const label = (map, v) => (nullify(v) == null ? null : (map[Number(v)] ?? 'Unknown'));
const first = (o, ...keys) => { for (const k of keys) if (o?.[k] != null) return o[k]; return undefined; };

// ---------------------------------------------------------------------------
// Throttle — shared rolling window
// ---------------------------------------------------------------------------

function createThrottle(max, windowMs = 60000) {
  const stamps = [];
  return async function acquire() {
    for (;;) {
      const now = Date.now();
      while (stamps.length && now - stamps[0] >= windowMs) stamps.shift();
      if (stamps.length < max) { stamps.push(now); return; }
      await new Promise(r => setTimeout(r, stamps[0] + windowMs - now + 5));
    }
  };
}

const callsPerMin = () => Math.max(1, Number(process.env.EC_GROUP_CALLS_PER_MIN) || 25);
let sharedThrottle = null;
const defaultThrottle = () => (sharedThrottle ||= createThrottle(callsPerMin()));

// ---------------------------------------------------------------------------
// EC errors → friendly messages
// ---------------------------------------------------------------------------

function friendly(e) {
  if (e.status === 401 || e.status === 403) {
    e.message = 'Endpoint Central rejected the request — the key needs the SOM/Common read scope and an administrator account';
    e.status  = 403;
  } else if (e.status === 429) {
    e.message = 'Endpoint Central rate limit reached (30 calls/min) — wait 5 minutes and try again';
  }
  return e;
}

async function configured() {
  const config = await ec.getConfig();
  const creds  = config.auth_mode === 'credentials';
  if (!config.server_url || (creds ? !config.session_token : !config.api_key)) {
    const err = new Error('Endpoint Central is not configured — set the Server URL and API key first');
    err.status = 400;
    throw err;
  }
  return config;
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

function parseGroupList(json) {
  if (!json) return [];
  const list = json?.message_response?.getcglist?.response?.result?.cg_list
            ?? json?.messageResponse?.getcglist?.response?.result?.cg_list
            ?? [];
  return (Array.isArray(list) ? list : []).map(g => ({
    group_id:    first(g, 'groupId', 'group_id', 'cgId', 'cg_id', 'id'),
    name:        first(g, 'groupName', 'group_name', 'cgName', 'cg_name', 'name'),
    group_type:  nullify(first(g, 'groupType', 'group_type', 'cgType', 'type')),
    category:    nullify(first(g, 'groupCategory', 'category', 'group_category')),
    domain:      nullify(first(g, 'domainName', 'domain_name', 'domain')),
    created_on:  Number(nullify(first(g, 'createdOn', 'created_on', 'createdTime'))) || null,
    modified_on: Number(nullify(first(g, 'modifiedOn', 'modified_on', 'modifiedTime', 'lastModified'))) || null,
  })).filter(g => g.group_id != null && g.name);
}

const isUsersGroup   = g => /user/i.test(g.group_type || '');
const isDynamicGroup = g => /dynamic/i.test(g.group_type || '');

function parseGroupDetails(json) {
  const result = json?.message_response?.getcgdetails?.response?.result
              ?? json?.messageResponse?.getcgdetails?.response?.result
              ?? json?.message_response?.response?.result
              ?? json?.message_response?.result
              ?? {};
  const members = (result.groupMembers ?? result.group_members ?? []).map(m => ({
    resource_id: String(first(m, 'resourceId', 'resource_id', 'resourceID')),
    name:        nullify(first(m, 'name', 'computerName', 'resource_name')),
    domain:      nullify(first(m, 'domainName', 'domain_name', 'domain')),
    os_platform: label(OS_PLATFORM, first(m, 'osPlatform', 'os_platform')),
  })).filter(m => m.resource_id !== 'undefined');
  const criteria = result.criteriaPattern != null || result.criteriaList != null
    ? { criteriaPattern: result.criteriaPattern ?? null, criteriaList: result.criteriaList ?? null }
    : null;
  return { members, criteria };
}

// ---------------------------------------------------------------------------
// Store — all SQL for the sync lives here so tests can swap it out
// ---------------------------------------------------------------------------

const store = {
  async existingGroups() {
    const { rows } = await db.query('SELECT group_id, modified_on, members_synced_modified FROM ec_custom_groups');
    return new Map(rows.map(r => [String(r.group_id), r]));
  },
  async upsertGroups(groups) {
    for (const g of groups) {
      await db.query(
        `INSERT INTO ec_custom_groups (group_id, name, group_type, category, domain, created_on, modified_on)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (group_id) DO UPDATE SET
           name = EXCLUDED.name, group_type = EXCLUDED.group_type, category = EXCLUDED.category,
           domain = EXCLUDED.domain, created_on = EXCLUDED.created_on, modified_on = EXCLUDED.modified_on`,
        [g.group_id, g.name, g.group_type, g.category, g.domain, g.created_on, g.modified_on]);
    }
  },
  async deleteGroupsExcept(ids) {
    await db.query('DELETE FROM ec_custom_groups WHERE NOT (group_id = ANY($1::bigint[]))', [ids]);
  },
  async replaceMembers(group, members, criteria) {
    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      await client.query('DELETE FROM ec_group_members WHERE group_id = $1', [group.group_id]);
      for (const m of members) {
        await client.query(
          `INSERT INTO ec_group_members (group_id, resource_id, name, domain, os_platform)
           VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`,
          [group.group_id, m.resource_id, m.name, m.domain, m.os_platform]);
      }
      await client.query(
        `UPDATE ec_custom_groups SET members_synced_modified = $2, members_synced_at = NOW(),
                member_count = $3, criteria = $4 WHERE group_id = $1`,
        [group.group_id, group.modified_on, criteria ? null : members.length, criteria ? JSON.stringify(criteria) : null]);
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      throw e;
    } finally { client.release(); }
  },
};

// ---------------------------------------------------------------------------
// Sync (background, one at a time)
// ---------------------------------------------------------------------------

const idle = () => ({ running: false, phase: 'idle', done: 0, total: 0, errors: [] });
let progress   = idle();
let lastResult = null;

const getSyncState = () => ({ progress: { ...progress, errors: [...progress.errors] }, last_result: lastResult });

// Runs the sync to completion. Exposed separately from startSync so tests can await it.
async function runSync({ force = false, config, throttle = defaultThrottle(), store: st = store } = {}) {
  config ||= await configured();
  const t0 = Date.now();
  let calls = 0;
  const get = (path, query, opts = {}) => ec.dcapiGet(config, path, {
    query, ...opts,
    beforeRequest: async () => { await throttle(); calls++; },
  });
  const result = { ok: true, forced: !!force, calls: 0, groups: 0, fetched: 0, skipped: 0, errors: [], message: '' };

  try {
    progress.phase = 'listing';
    const { json } = await get('/api/1.4/customgroup/getCGList', {}, { allowEmpty: true });
    const groups = parseGroupList(json);
    result.groups = groups.length;

    const existing = await st.existingGroups();
    await st.upsertGroups(groups);
    await st.deleteGroupsExcept(groups.map(g => g.group_id));

    const todo = groups.filter(g => {
      if (isUsersGroup(g)) return false;
      const prev = existing.get(String(g.group_id));
      return force || !prev || prev.members_synced_modified == null
          || Number(prev.members_synced_modified) !== Number(g.modified_on);
    });
    result.skipped = groups.length - todo.length;
    progress.phase = 'members';
    progress.total = todo.length;

    for (const g of todo) {
      try {
        const { json: d } = await get('/api/1.4/customgroup/getCGDetails', { cgName: g.name });
        const { members, criteria } = parseGroupDetails(d);
        // Dynamic groups: EC returns only the rule. Never invent members.
        const dyn = isDynamicGroup(g);
        await st.replaceMembers(g, dyn ? [] : members, dyn ? (criteria ?? {}) : null);
        result.fetched++;
      } catch (e) {
        if (e.status === 429) throw e;
        const msg = friendly(e).message;
        result.errors.push({ group: g.name, error: msg });
        progress.errors.push({ group: g.name, error: msg });
      }
      progress.done++;
    }
    result.message = `Synced ${result.fetched} of ${groups.length} group(s)` +
      (result.errors.length ? `, ${result.errors.length} failed` : '');
  } catch (e) {
    friendly(e);
    result.ok = false;
    result.message = e.status === 429 ? e.message : `Sync stopped: ${e.message}`;
    result.errors.push({ group: null, error: e.message });
  }
  result.calls = calls;
  result.duration_ms = Date.now() - t0;
  result.finished_at = new Date().toISOString();
  return result;
}

// Starts the sync in the background. Throws 409 if one is already running.
async function startSync({ force = false } = {}) {
  if (progress.running) {
    const err = new Error('A group sync is already running');
    err.status = 409;
    throw err;
  }
  const config = await configured();
  progress = { running: true, phase: 'starting', done: 0, total: 0, errors: [] };
  runSync({ force, config })
    .then(r => { lastResult = r; })
    .catch(e => { lastResult = { ok: false, message: e.message, finished_at: new Date().toISOString() }; })
    .finally(() => { progress = idle(); });
  return getSyncState();
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

async function listGroups() {
  const { rows } = await db.query(
    `SELECT group_id::text AS group_id, name, group_type, category, domain,
            created_on::text AS created_on, modified_on::text AS modified_on,
            member_count, members_synced_at, criteria
       FROM ec_custom_groups ORDER BY lower(name)`);
  return rows.map(r => ({
    ...r,
    created_on:  epochToIso(r.created_on),
    modified_on: epochToIso(r.modified_on),
    dynamic:     isDynamicGroup(r),
  }));
}

async function groupMembers(id) {
  const { rows } = await db.query(
    `SELECT resource_id, name, domain, os_platform
       FROM ec_group_members WHERE group_id = $1 ORDER BY lower(name)`, [id]);
  const { hosts } = await inventoryLookup();
  return rows.map(r => ({
    ...r,
    in_inventory: hosts.has(String(r.name || '').toLowerCase().split('.')[0]),
  }));
}

// Attach `groups` to computers by resource_id, falling back to the short hostname.
// Returns false when groups were never synced (caller falls back to the old path).
async function attachGroups(agents) {
  let rows;
  try {
    const { rows: [c] } = await db.query(
      'SELECT COUNT(*)::int AS n FROM ec_custom_groups WHERE members_synced_at IS NOT NULL');
    if (!c.n) return false;
    ({ rows } = await db.query(
      `SELECT m.resource_id, lower(m.name) AS name, g.name AS group_name
         FROM ec_group_members m JOIN ec_custom_groups g USING (group_id)`));
  } catch (e) {
    if (e.code === '42P01') return false;
    throw e;
  }
  const short = s => String(s || '').toLowerCase().split('.')[0];
  const byId = new Map(), byName = new Map();
  const add = (m, k, v) => { if (k) (m.get(k) || m.set(k, new Set()).get(k)).add(v); };
  for (const r of rows) { add(byId, String(r.resource_id), r.group_name); add(byName, short(r.name), r.group_name); }
  for (const a of agents) {
    const set = (a.resource_id != null && byId.get(String(a.resource_id))) || byName.get(short(a.computer_name));
    a.custom_groups = set ? [...set].sort() : [];
  }
  return true;
}

// ---------------------------------------------------------------------------
// Staged computers
// ---------------------------------------------------------------------------

const STAGED_TTL  = 60 * 1000;
const STAGED_PAGE = 500;
const stagedCache = new Map();

function normalizeStaged(r) {
  return {
    resource_id:     nullify(first(r, 'resourceId', 'resource_id', 'computerId')),
    name:            nullify(first(r, 'computerName', 'computer_name', 'resourceName', 'resource_name', 'name', 'netbiosName')),
    ip_address:      nullify(first(r, 'ipAddress', 'ip_address', 'ipaddress')),
    mac_address:     nullify(first(r, 'macAddress', 'mac_address')),
    domain:          nullify(first(r, 'domainName', 'domain_name', 'domain')),
    os_name:         nullify(first(r, 'osName', 'os_name', 'operatingSystem', 'os')),
    os_platform:     label(OS_PLATFORM, first(r, 'osPlatform', 'os_platform')),
    remote_office:   nullify(first(r, 'remoteOffice', 'remote_office', 'branchOfficeName')),
    approval_status: label(APPROVAL, first(r, 'approvalStatus', 'approval_status')),
    discovered_on:   epochToIso(first(r, 'discoveredTime', 'discovered_time', 'addedTime', 'requestedTime')),
  };
}

// Identifiers of everything in our own records, for Found / Not found matching
async function inventoryLookup() {
  const tables = ['assets', 'beijing_assets', 'ext_assets', 'physical_esxi_servers'];
  const macs = new Set(), ips = new Set(), hosts = new Set();
  const normMac = s => String(s || '').toLowerCase().replace(/[^0-9a-f]/g, '');
  for (const t of tables) {
    try {
      const { rows } = await db.query(
        `SELECT vm_name, os_hostname, ip_address, mac_address FROM ${t} WHERE deleted_at IS NULL`);
      for (const r of rows) {
        if (normMac(r.mac_address).length >= 12) macs.add(normMac(r.mac_address));
        if (r.ip_address) ips.add(String(r.ip_address).trim());
        for (const h of [r.vm_name, r.os_hostname]) if (h) hosts.add(String(h).toLowerCase().split('.')[0]);
      }
    } catch (e) { if (e.code !== '42P01') throw e; }
  }
  return { macs, ips, hosts, normMac };
}

async function fetchStaged(status = 3, { refresh = false } = {}) {
  const hit = stagedCache.get(status);
  if (!refresh && hit && Date.now() - hit.at < STAGED_TTL) return hit.data;

  const config   = await configured();
  const throttle = defaultThrottle();
  const rows = [];
  try {
    let totalPages = 1;
    for (let page = 1; page <= totalPages && page <= 200; page++) {
      const { json } = await ec.dcapiGet(config, '/dcapi/som/approval/computers-info', {
        accept: 'application/approvalComputersRes.v1+json',
        query: { approvalStatus: status, page, limit: STAGED_PAGE },
        allowEmpty: true,
        beforeRequest: throttle,
      });
      const batch = json?.messageResponse ?? json?.message_response ?? [];
      if (!Array.isArray(batch) || !batch.length) break;
      rows.push(...batch);
      totalPages = Number(json.totalPages) || 1;
    }
  } catch (e) { throw friendly(e); }

  const inv = await inventoryLookup();
  const data = rows.map(normalizeStaged).map(r => ({
    ...r,
    in_inventory: !!((r.mac_address && inv.macs.has(inv.normMac(r.mac_address)))
                  || (r.ip_address  && inv.ips.has(String(r.ip_address).trim()))
                  || (r.name        && inv.hosts.has(String(r.name).toLowerCase().split('.')[0]))),
  }));
  stagedCache.set(status, { at: Date.now(), data });
  return data;
}

module.exports = {
  LIVE_STATUS, INSTALL_STATUS, OS_PLATFORM, APPROVAL,
  nullify, epochToIso, label,
  createThrottle, parseGroupList, parseGroupDetails,
  runSync, startSync, getSyncState,
  listGroups, groupMembers, attachGroups, fetchStaged, normalizeStaged,
};
