/**
 * vmwareService.js
 * ----------------
 * Connects to vCenter/ESXi via the vSphere REST API (7.0+).
 * Collects VM inventory: name, IPs, MACs, OS info, power state,
 * ESXi placement, CPU/memory, and snapshot counts.
 */

const https = require('https');
const dns = require('dns').promises;

class VMwareAuthError extends Error {}
class VMwareConnectionError extends Error {}

const IPV4_RE = /^(?:\d{1,3}\.){3}\d{1,3}$/;

// Resolve an ESXi host's registered name to an IP. If vCenter registered the
// host by IP already, use it as-is; otherwise try a DNS lookup and fall back
// to the name when resolution fails.
async function resolveHostIp(name) {
  if (!name) return 'Not Available';
  if (IPV4_RE.test(name)) return name;
  try {
    const { address } = await dns.lookup(name, { family: 4 });
    return address || name;
  } catch { return name; }
}

// ---------------------------------------------------------------------------
// Low-level HTTPS helper
// ---------------------------------------------------------------------------

function makeAgent(verifySSL) {
  return new https.Agent({ rejectUnauthorized: !!verifySSL });
}

function httpsReq({ hostname, port, path, method, headers, body, verifySSL }) {
  return new Promise((resolve, reject) => {
    const agent = makeAgent(verifySSL);
    const bodyBuf = body ? Buffer.from(typeof body === 'string' ? body : JSON.stringify(body)) : null;

    const req = https.request(
      {
        hostname,
        port,
        path,
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(bodyBuf ? { 'Content-Length': bodyBuf.length } : {}),
          ...headers,
        },
        agent,
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
      }
    );
    req.on('error', (err) => reject(new VMwareConnectionError(`Cannot reach ${hostname}:${port} — ${err.message}`)));
    if (bodyBuf) req.write(bodyBuf);
    req.end();
  });
}

// vSphere 6.x wraps every /rest response in { value: ... }; 7.0+ /api returns
// bare payloads. Unwrap when `value` is the sole key.
function unwrapValue(parsed) {
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      && Object.keys(parsed).length === 1 && 'value' in parsed) {
    return parsed.value;
  }
  return parsed;
}

async function apiGet(hostname, port, path, sessionId, verifySSL) {
  // 7.0+ uses /api/..., 6.x uses /rest/... — try the given path first, then
  // fall back to the legacy prefix on 404/405 (e.g. "HTTP method GET is not
  // supported by this URL" from 6.x vCenters).
  const paths = path.startsWith('/api/')
    ? [path, path.replace(/^\/api\//, '/rest/')]
    : [path];

  let lastErr = null;
  for (const p of paths) {
    const { status, body } = await httpsReq({
      hostname, port, path: p, method: 'GET',
      headers: { 'vmware-api-session-id': sessionId },
      verifySSL,
    });
    if (status === 401 || status === 403) throw new VMwareAuthError(`Session invalid or unauthorized (${p})`);
    if (status === 404 || status === 405) {
      lastErr = new Error(`vSphere API error ${status} on ${p}: ${body.slice(0, 200)}`);
      continue; // try legacy prefix
    }
    if (status >= 400) throw new Error(`vSphere API error ${status} on ${p}: ${body.slice(0, 200)}`);
    try { return unwrapValue(JSON.parse(body)); } catch { return body; }
  }
  throw lastErr || new Error(`vSphere API unreachable on ${path}`);
}

// ---------------------------------------------------------------------------
// Session management
// ---------------------------------------------------------------------------

async function createSession(hostname, port, username, password, verifySSL) {
  const creds = Buffer.from(`${username}:${password}`).toString('base64');

  // Try vSphere 7.0+ REST API first
  for (const path of ['/api/session', '/rest/com/vmware/cis/session']) {
    const { status, body } = await httpsReq({
      hostname, port, path, method: 'POST',
      headers: { Authorization: `Basic ${creds}` },
      verifySSL,
    });

    if (status === 401 || status === 403) {
      throw new VMwareAuthError(`Invalid credentials for ${username}@${hostname}`);
    }
    if (status === 404) continue; // try next path
    if (status === 201 || status === 200) {
      try {
        const parsed = JSON.parse(body);
        // 7.0+ returns a bare string; 6.x wraps in { value: "..." }
        return typeof parsed === 'string' ? parsed : (parsed.value || parsed);
      } catch {
        return body.replace(/"/g, '');
      }
    }
    throw new VMwareConnectionError(`Failed to authenticate: HTTP ${status}`);
  }
  throw new VMwareConnectionError(`Could not reach vSphere API on ${hostname}:${port}`);
}

async function destroySession(hostname, port, sessionId, verifySSL) {
  for (const path of ['/api/session', '/rest/com/vmware/cis/session']) {
    try {
      const { status } = await httpsReq({
        hostname, port, path, method: 'DELETE',
        headers: { 'vmware-api-session-id': sessionId },
        verifySSL,
      });
      if (status < 400) return;
    } catch { /* best-effort logout */ }
  }
}

// ---------------------------------------------------------------------------
// VM and host discovery helpers
// ---------------------------------------------------------------------------

// vSphere 6.x wraps list responses in { value: [...] }; 7.0+ returns bare arrays.
function unwrapList(r) {
  if (Array.isArray(r)) return r;
  if (r && Array.isArray(r.value)) return r.value;
  return null;
}

async function listESXiHosts(hostname, port, sessionId, verifySSL) {
  try {
    const hosts = await apiGet(hostname, port, '/api/vcenter/host', sessionId, verifySSL);
    return unwrapList(hosts) || [];
  } catch (err) {
    console.warn('[vmware] could not list ESXi hosts:', err.message);
    return [];
  }
}

async function listVMs(hostname, port, sessionId, verifySSL) {
  const vms = await apiGet(hostname, port, '/api/vcenter/vm', sessionId, verifySSL);
  return unwrapList(vms) || [];
}

// List the VMs placed on one ESXi host. The 7.0+ /api endpoint takes `hosts=`,
// the legacy 6.x style used `filter.hosts=` — try both so placement mapping
// works across vSphere versions.
async function listVMsOnHost(hostname, port, sessionId, hostId, verifySSL) {
  const enc = encodeURIComponent(hostId);
  for (const qs of [`hosts=${enc}`, `filter.hosts=${enc}`]) {
    try {
      const r = await apiGet(hostname, port, `/api/vcenter/vm?${qs}`, sessionId, verifySSL);
      const list = unwrapList(r);
      if (list !== null) return list;
    } catch { /* try next param style */ }
  }
  return null; // both styles failed
}

async function getVMDetails(hostname, port, sessionId, vmId, verifySSL) {
  try {
    return await apiGet(hostname, port, `/api/vcenter/vm/${vmId}`, sessionId, verifySSL);
  } catch { return null; }
}

async function getGuestIdentity(hostname, port, sessionId, vmId, verifySSL) {
  try {
    return await apiGet(hostname, port, `/api/vcenter/vm/${vmId}/guest/identity`, sessionId, verifySSL);
  } catch { return null; }
}

async function getGuestNetworking(hostname, port, sessionId, vmId, verifySSL) {
  try {
    return await apiGet(hostname, port, `/api/vcenter/vm/${vmId}/guest/networking/interfaces`, sessionId, verifySSL);
  } catch { return null; }
}

async function getVMSnapshots(hostname, port, sessionId, vmId, verifySSL) {
  try {
    const snaps = await apiGet(hostname, port, `/api/vcenter/vm/${vmId}/snapshot`, sessionId, verifySSL);
    return Array.isArray(snaps) ? snaps : [];
  } catch { return []; }
}

// ---------------------------------------------------------------------------
// Normalise a single VM record
// ---------------------------------------------------------------------------

function normalisePowerState(raw) {
  if (!raw) return 'unknown';
  const s = String(raw).toLowerCase();
  if (s.includes('on'))        return 'poweredOn';
  if (s.includes('off'))       return 'poweredOff';
  if (s.includes('suspend'))   return 'suspended';
  return s;
}

function extractMacs(details) {
  const macs = [];
  if (!details || !details.nics) return macs;
  // 7.0+ /api: nics is an object keyed by nic id.
  // 6.x /rest: nics is an array of { key, value } pairs.
  for (const entry of Object.values(details.nics)) {
    const nic = entry && entry.value && typeof entry.value === 'object' ? entry.value : entry;
    if (nic && nic.mac_address) macs.push(nic.mac_address);
  }
  return macs;
}

function extractIps(guestNetworking, guestIdentity) {
  const ips = new Set();
  // From networking interfaces (most detailed)
  if (Array.isArray(guestNetworking)) {
    for (const iface of guestNetworking) {
      const addrs = iface?.ip?.ip_addresses || [];
      for (const a of addrs) {
        const ip = a?.ip_address;
        if (ip && !ip.startsWith('fe80') && ip !== '127.0.0.1' && ip !== '::1') {
          ips.add(ip);
        }
      }
    }
  }
  // Fallback: guest identity primary IP
  if (guestIdentity?.ip_address && !ips.size) {
    ips.add(guestIdentity.ip_address);
  }
  return ips.size ? [...ips] : ['Not Available'];
}

function extractOsInfo(details, guestIdentity) {
  const osType    = guestIdentity?.family     || details?.guest_OS || 'Not Available';
  const osVersion = guestIdentity?.full_name?.default_message
                    || guestIdentity?.full_name
                    || 'Not Available';
  return { osType, osVersion };
}

function extractSnapshots(snaps) {
  if (!snaps || !snaps.length) return { snapshot_count: 0, snapshot_oldest: '' };
  let oldest = null;
  for (const s of snaps) {
    const ct = s.create_time ? new Date(s.create_time) : null;
    if (ct && (!oldest || ct < oldest)) oldest = ct;
  }
  return {
    snapshot_count: snaps.length,
    snapshot_oldest: oldest ? oldest.toISOString().replace('T', ' ').slice(0, 19) + ' UTC' : '',
  };
}

// ---------------------------------------------------------------------------
// Main discovery pipeline
// ---------------------------------------------------------------------------

async function discoverWithSession(hostname, port, sessionId, verifySSL) {
  // 1. Get all ESXi hosts for name+ID mapping
  const esxiHosts = await listESXiHosts(hostname, port, sessionId, verifySSL);
  const hostById = {};
  for (const h of esxiHosts) {
    if (h.host) hostById[h.host] = h.name || h.host;
  }

  // 2. Build host→VM mapping by listing VMs per host (gives ESXi placement)
  const vmToHost = {};
  for (const h of esxiHosts) {
    const vmsOnHost = await listVMsOnHost(hostname, port, sessionId, h.host, verifySSL);
    if (vmsOnHost === null) {
      console.warn(`[vmware] could not list VMs for ESXi host ${h.name} (${h.host})`);
      continue;
    }
    // h.name is how the host is registered in vCenter (IP or FQDN);
    // resolve to an actual IP for the esxi_host_ip column.
    const hostIp = await resolveHostIp(h.name);
    for (const v of vmsOnHost) {
      if (v.vm) vmToHost[v.vm] = { name: h.name, ip: hostIp };
    }
  }

  // 3. Get full VM list
  const rawVMs = await listVMs(hostname, port, sessionId, verifySSL);

  // 4. Per-VM detail collection (parallel, capped at 10)
  const CONCURRENCY = 10;
  const inventory = [];
  for (let i = 0; i < rawVMs.length; i += CONCURRENCY) {
    const batch = rawVMs.slice(i, i + CONCURRENCY);
    const results = await Promise.all(batch.map(async (vm) => {
      try {
        const vmId = vm.vm;
        if (!vmId) return null;

        const [details, guestId, guestNet, snaps] = await Promise.all([
          getVMDetails(hostname, port, sessionId, vmId, verifySSL),
          getGuestIdentity(hostname, port, sessionId, vmId, verifySSL),
          getGuestNetworking(hostname, port, sessionId, vmId, verifySSL),
          getVMSnapshots(hostname, port, sessionId, vmId, verifySSL),
        ]);

        const macs = extractMacs(details);
        const ips  = extractIps(guestNet, guestId);
        const { osType, osVersion } = extractOsInfo(details, guestId);
        const { snapshot_count, snapshot_oldest } = extractSnapshots(snaps);
        const esxiPlacement = vmToHost[vmId] || { name: 'Not Available', ip: 'Not Available' };
        const powerState = normalisePowerState(vm.power_state || details?.power_state);

        return {
          name:                    vm.name || details?.name || 'Not Available',
          hostname:                guestId?.host_name || guestId?.name || 'Not Available',
          ips,
          esxi_host_name:          esxiPlacement.name,
          esxi_host_ip:            esxiPlacement.ip,
          os_type:                 osType,
          os_version:              osVersion,
          macs:                    macs.length ? macs : ['Not Available'],
          created_date:            'Not Available',
          power_state:             powerState,
          tools_status:            guestId ? 'guestToolsRunning' : 'guestToolsNotRunning',
          num_cpu:                 details?.cpu?.count ?? vm.cpu_count ?? null,
          memory_mb:               details?.memory?.size_MiB ?? vm.memory_size_MiB ?? null,
          storage_committed_gb:    '',
          storage_uncommitted_gb:  '',
          datastores:              [],
          snapshot_count,
          snapshot_oldest,
        };
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn('[vmware] skipping VM due to error:', err.message);
        return null;
      }
    }));
    for (const r of results) if (r) inventory.push(r);
  }

  return inventory;
}

async function discover(host, port, username, password, verifySSL) {
  let sessionId;
  try {
    sessionId = await createSession(host, port, username, password, verifySSL);
    return await discoverWithSession(host, port, sessionId, verifySSL);
  } finally {
    if (sessionId) await destroySession(host, port, sessionId, verifySSL);
  }
}

module.exports = { discover, VMwareAuthError, VMwareConnectionError };
