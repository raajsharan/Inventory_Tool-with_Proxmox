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
        // At socket-creation time so a hung DNS lookup/TCP handshake (e.g. a
        // firewall silently dropping packets) still trips it — without this
        // there was no timeout at all, so a hung host request/test-connection
        // would hang until an upstream reverse proxy gave up first, surfacing
        // as an opaque 504 with no useful error message.
        timeout: 10000,
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve({
          status: res.statusCode,
          body: Buffer.concat(chunks).toString('utf8'),
          headers: res.headers,
        }));
      }
    );
    req.on('error', (err) => reject(new VMwareConnectionError(`Cannot reach ${hostname}:${port} — ${err.message}`)));
    req.on('timeout', () => req.destroy(new VMwareConnectionError(`Timed out reaching ${hostname}:${port} after 10s`)));
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
  let authErr = null;
  for (const p of paths) {
    const { status, body } = await httpsReq({
      hostname, port, path: p, method: 'GET',
      headers: { 'vmware-api-session-id': sessionId },
      verifySSL,
    });
    if (status === 401 || status === 403) {
      // The session may only be valid for one API generation — try the other
      // prefix before declaring the session invalid.
      authErr = new VMwareAuthError(`Session invalid or unauthorized (${p})`);
      continue;
    }
    if (status === 404 || status === 405) {
      lastErr = new Error(`vSphere API error ${status} on ${p}: ${body.slice(0, 200)}`);
      continue; // try legacy prefix
    }
    if (status >= 400) throw new Error(`vSphere API error ${status} on ${p}: ${body.slice(0, 200)}`);
    try { return unwrapValue(JSON.parse(body)); } catch { return body; }
  }
  throw authErr || lastErr || new Error(`vSphere API unreachable on ${path}`);
}

// ---------------------------------------------------------------------------
// Session management
// ---------------------------------------------------------------------------

// A usable vSphere session id is an opaque token — reject HTML pages,
// objects, or anything else a non-API 2xx response might hand back.
function extractSessionId(body) {
  let candidate;
  try {
    const parsed = JSON.parse(body);
    // 7.0+ returns a bare string; 6.x wraps in { value: "..." }
    candidate = typeof parsed === 'string' ? parsed : parsed?.value;
  } catch {
    candidate = String(body || '').replace(/"/g, '').trim();
  }
  if (typeof candidate !== 'string') return null;
  candidate = candidate.trim();
  if (!/^[A-Za-z0-9._\-+/=]{8,}$/.test(candidate)) return null; // not a token
  return candidate;
}

async function createSession(hostname, port, username, password, verifySSL) {
  const creds = Buffer.from(`${username}:${password}`).toString('base64');

  let sawAuthFailure = false;
  let lastStatus = null;
  // cis session works on 6.5 → 8.x; /api/session on 7.0+. Some 6.x web
  // servers answer /api/session with a 2xx non-API page, so try the
  // universally valid endpoint first and validate whatever comes back.
  for (const path of ['/rest/com/vmware/cis/session', '/api/session']) {
    let resp;
    try {
      resp = await httpsReq({
        hostname, port, path, method: 'POST',
        headers: { Authorization: `Basic ${creds}` },
        verifySSL,
      });
    } catch (e) {
      lastStatus = e.message;
      continue;
    }
    const { status, body } = resp;
    lastStatus = status;

    if (status === 401 || status === 403) { sawAuthFailure = true; continue; }
    if (status === 201 || status === 200) {
      const sessionId = extractSessionId(body);
      if (sessionId) return sessionId;
      // 2xx but no valid token (HTML page, envelope object…) — try next endpoint
      continue;
    }
    // 404/405/5xx — endpoint not available on this version, try next
  }

  if (sawAuthFailure) {
    throw new VMwareAuthError(`Invalid credentials for ${username}@${hostname}`);
  }
  throw new VMwareConnectionError(
    `Could not establish a vSphere API session on ${hostname}:${port} (last status: ${lastStatus})`,
  );
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

// ---------------------------------------------------------------------------
// SOAP (/sdk) fallback — standalone ESXi hosts have no Automation REST API,
// only the vSphere Web Services (vim25) SOAP endpoint.
// ---------------------------------------------------------------------------

const xmlEscape = (s) => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&apos;');

const xmlUnescape = (s) => String(s)
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
  .replace(/&apos;/g, "'").replace(/&#39;/g, "'").replace(/&amp;/g, '&');

async function soapRequest(hostname, port, verifySSL, innerXml, cookie) {
  const envelope =
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"` +
    ` xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:vim25="urn:vim25">` +
    `<soapenv:Body>${innerXml}</soapenv:Body></soapenv:Envelope>`;
  const { status, body, headers } = await httpsReq({
    hostname, port, path: '/sdk', method: 'POST',
    headers: {
      'Content-Type': 'text/xml; charset=utf-8',
      SOAPAction: 'urn:vim25/6.0',
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: envelope,
    verifySSL,
  });
  if (/InvalidLoginFault|InvalidLogin</.test(body)) {
    throw new VMwareAuthError('Invalid credentials (SOAP login rejected)');
  }
  if (status >= 400 && !body.includes('soapenv:Body')) {
    throw new VMwareConnectionError(`SOAP /sdk error ${status}: ${body.slice(0, 200)}`);
  }
  const fault = body.match(/<faultstring>([\s\S]*?)<\/faultstring>/);
  if (fault) throw new Error(`SOAP fault: ${xmlUnescape(fault[1]).slice(0, 300)}`);
  return { body, headers };
}

const soapTag = (body, tag) => {
  const m = body.match(new RegExp(`<${tag}[^>]*>([^<]*)</${tag}>`));
  return m ? xmlUnescape(m[1]) : null;
};

async function soapLogin(hostname, port, username, password, verifySSL) {
  const sc = await soapRequest(hostname, port, verifySSL,
    `<vim25:RetrieveServiceContent><vim25:_this type="ServiceInstance">ServiceInstance</vim25:_this></vim25:RetrieveServiceContent>`);
  const refs = {
    sessionManager:    soapTag(sc.body, 'sessionManager'),
    propertyCollector: soapTag(sc.body, 'propertyCollector'),
    rootFolder:        soapTag(sc.body, 'rootFolder'),
    viewManager:       soapTag(sc.body, 'viewManager'),
  };
  if (!refs.sessionManager || !refs.propertyCollector) {
    throw new VMwareConnectionError('SOAP /sdk did not return a vim25 ServiceContent');
  }
  const login = await soapRequest(hostname, port, verifySSL,
    `<vim25:Login><vim25:_this type="SessionManager">${xmlEscape(refs.sessionManager)}</vim25:_this>` +
    `<vim25:userName>${xmlEscape(username)}</vim25:userName>` +
    `<vim25:password>${xmlEscape(password)}</vim25:password></vim25:Login>`);
  const setCookie = login.headers['set-cookie'];
  const cookie = Array.isArray(setCookie)
    ? setCookie.map(c => c.split(';')[0]).join('; ')
    : (setCookie ? setCookie.split(';')[0] : null);
  if (!cookie) throw new VMwareConnectionError('SOAP login returned no session cookie');
  return { cookie, refs };
}

async function soapRetrieveAll(hostname, port, verifySSL, cookie, refs, objType, pathSets) {
  const view = await soapRequest(hostname, port, verifySSL,
    `<vim25:CreateContainerView><vim25:_this type="ViewManager">${xmlEscape(refs.viewManager)}</vim25:_this>` +
    `<vim25:container type="Folder">${xmlEscape(refs.rootFolder)}</vim25:container>` +
    `<vim25:type>${objType}</vim25:type><vim25:recursive>true</vim25:recursive></vim25:CreateContainerView>`,
    cookie);
  const viewId = soapTag(view.body, 'returnval');
  if (!viewId) throw new Error(`CreateContainerView(${objType}) returned no view`);

  const paths = pathSets.map(p => `<vim25:pathSet>${p}</vim25:pathSet>`).join('');
  const spec =
    `<vim25:specSet>` +
    `<vim25:propSet><vim25:type>${objType}</vim25:type>${paths}</vim25:propSet>` +
    `<vim25:objectSet><vim25:obj type="ContainerView">${viewId}</vim25:obj><vim25:skip>true</vim25:skip>` +
    `<vim25:selectSet xsi:type="vim25:TraversalSpec"><vim25:name>view</vim25:name>` +
    `<vim25:type>ContainerView</vim25:type><vim25:path>view</vim25:path><vim25:skip>false</vim25:skip>` +
    `</vim25:selectSet></vim25:objectSet></vim25:specSet><vim25:options/>`;

  let resp = await soapRequest(hostname, port, verifySSL,
    `<vim25:RetrievePropertiesEx><vim25:_this type="PropertyCollector">${xmlEscape(refs.propertyCollector)}</vim25:_this>${spec}</vim25:RetrievePropertiesEx>`,
    cookie);

  let xml = resp.body;
  const objects = [];
  for (;;) {
    for (const m of xml.matchAll(/<objects>([\s\S]*?)<\/objects>/g)) {
      const block = m[1];
      // Object's own moref (e.g. "datastore-15") — not needed by existing
      // callers, but getHostStats() uses it to match a host's `datastore`
      // references back to each Datastore object's capacity/freeSpace.
      const objMatch = block.match(/<obj[^>]*>([^<]+)<\/obj>/);
      const props = { __obj: objMatch ? objMatch[1] : null };
      for (const pm of block.matchAll(/<propSet>\s*<name>([^<]+)<\/name>\s*<val[^>]*>([\s\S]*?)<\/val>\s*<\/propSet>/g)) {
        props[pm[1]] = pm[2];
      }
      objects.push(props);
    }
    const token = soapTag(xml, 'token');
    if (!token) break;
    resp = await soapRequest(hostname, port, verifySSL,
      `<vim25:ContinueRetrievePropertiesEx><vim25:_this type="PropertyCollector">${xmlEscape(refs.propertyCollector)}</vim25:_this>` +
      `<vim25:token>${xmlEscape(token)}</vim25:token></vim25:ContinueRetrievePropertiesEx>`,
      cookie);
    xml = resp.body;
  }
  return objects;
}

function soapExtractIps(guestNetXml, guestIp) {
  const ips = new Set();
  if (guestNetXml) {
    for (const m of guestNetXml.matchAll(/<ipAddress>([^<]+)<\/ipAddress>/g)) {
      const ip = m[1].trim();
      if (ip && !ip.startsWith('fe80') && ip !== '127.0.0.1' && ip !== '::1' && !ip.includes('>')) ips.add(ip);
    }
  }
  if (!ips.size && guestIp) ips.add(guestIp);
  return ips.size ? [...ips] : ['Not Available'];
}

async function discoverViaSoap(hostname, port, username, password, verifySSL) {
  const { cookie, refs } = await soapLogin(hostname, port, username, password, verifySSL);
  try {
    // Host name — standalone ESXi has exactly one HostSystem.
    let esxiName = hostname;
    try {
      const hostObjs = await soapRetrieveAll(hostname, port, verifySSL, cookie, refs, 'HostSystem', ['name']);
      if (hostObjs[0]?.name) esxiName = xmlUnescape(hostObjs[0].name);
    } catch { /* keep connection host as name */ }
    const esxiIp = IPV4_RE.test(hostname) ? hostname : await resolveHostIp(esxiName);

    // NOTE: config.createDate only exists on 6.7+ — requesting an unknown
    // property faults the whole PropertyCollector query on older ESXi.
    const vms = await soapRetrieveAll(hostname, port, verifySSL, cookie, refs, 'VirtualMachine', [
      'name', 'guest.hostName', 'guest.ipAddress', 'guest.net', 'guest.toolsRunningStatus',
      'config.guestId', 'config.guestFullName',
      'config.hardware.numCPU', 'config.hardware.memoryMB', 'config.hardware.device',
      'runtime.powerState', 'snapshot.rootSnapshotList', 'summary.storage',
    ]);

    return vms.map(p => {
      const macs = [...(p['config.hardware.device'] || '').matchAll(/<macAddress>([^<]+)<\/macAddress>/g)]
        .map(m => m[1]);
      const snapTimes = [...(p['snapshot.rootSnapshotList'] || '').matchAll(/<createTime>([^<]+)<\/createTime>/g)]
        .map(m => new Date(m[1])).filter(d => !isNaN(d));
      const committed   = Number(soapTag(p['summary.storage'] || '', 'committed'))   || null;
      const uncommitted = Number(soapTag(p['summary.storage'] || '', 'uncommitted')) || null;
      const oldest = snapTimes.length ? new Date(Math.min(...snapTimes.map(d => d.getTime()))) : null;

      return {
        name:                   p.name ? xmlUnescape(p.name) : 'Not Available',
        hostname:               p['guest.hostName'] ? xmlUnescape(p['guest.hostName']) : 'Not Available',
        ips:                    soapExtractIps(p['guest.net'], p['guest.ipAddress']),
        esxi_host_name:         esxiName,
        esxi_host_ip:           esxiIp,
        os_type:                p['config.guestId'] || 'Not Available',
        os_version:             p['config.guestFullName'] ? xmlUnescape(p['config.guestFullName']) : 'Not Available',
        macs:                   macs.length ? macs : ['Not Available'],
        created_date:           'Not Available',
        power_state:            normalisePowerState(p['runtime.powerState']),
        tools_status:           p['guest.toolsRunningStatus'] === 'guestToolsRunning' ? 'guestToolsRunning' : 'guestToolsNotRunning',
        num_cpu:                p['config.hardware.numCPU'] ? Number(p['config.hardware.numCPU']) : null,
        memory_mb:              p['config.hardware.memoryMB'] ? Number(p['config.hardware.memoryMB']) : null,
        storage_committed_gb:   committed   ? (committed   / 1024 ** 3).toFixed(1) : '',
        storage_uncommitted_gb: uncommitted ? (uncommitted / 1024 ** 3).toFixed(1) : '',
        datastores:             [],
        snapshot_count:         snapTimes.length,
        snapshot_oldest:        oldest ? oldest.toISOString().replace('T', ' ').slice(0, 19) + ' UTC' : '',
      };
    });
  } finally {
    try {
      await soapRequest(hostname, port, verifySSL,
        `<vim25:Logout><vim25:_this type="SessionManager">${xmlEscape(refs.sessionManager)}</vim25:_this></vim25:Logout>`,
        cookie);
    } catch { /* best-effort logout */ }
  }
}

// ---------------------------------------------------------------------------
// ESXi host hardware telemetry (CPU/RAM/disk/uptime) — vim25 SOAP only, since
// neither generation of the REST Automation API exposes host quickStats or
// datastore capacity. Returns ONE entry per HostSystem in inventory — a
// vCenter commonly manages many physical ESXi hosts with different hardware,
// so reporting only the first one (an earlier version of this) would show
// one arbitrary host's specs as if they applied to the whole vCenter entry.
// Best-effort: a stats-collection failure should never fail the whole
// discovery run, so callers should catch and ignore errors from this.
// ---------------------------------------------------------------------------
function computeHostStats(h, datastoresByRef) {
  const dsRefs = [...(h.datastore || '').matchAll(/<ManagedObjectReference[^>]*>([^<]+)<\/ManagedObjectReference>/g)]
    .map(m => m[1]);
  let diskTotalBytes = 0;
  let diskFreeBytes = 0;
  for (const ref of dsRefs) {
    const d = datastoresByRef.get(ref);
    if (!d) continue;
    diskTotalBytes += Number(d['summary.capacity']) || 0;
    diskFreeBytes  += Number(d['summary.freeSpace']) || 0;
  }

  const cpuCores      = Number(h['summary.hardware.numCpuCores']) || 0;
  // summary.hardware.cpuMhz is the speed of a SINGLE core, not total
  // capacity — total host CPU capacity is cpuMhz * numCpuCores.
  const cpuTotalMhz   = Number(h['summary.hardware.cpuMhz']) * cpuCores || 0;
  const cpuUsageMhz   = Number(h['summary.quickStats.overallCpuUsage']) || 0;
  const memTotalBytes = Number(h['summary.hardware.memorySize']) || 0;
  const memUsedMb     = Number(h['summary.quickStats.overallMemoryUsage']) || 0;
  const bootTime      = h['summary.runtime.bootTime'] ? new Date(h['summary.runtime.bootTime']) : null;
  const memTotalMb    = memTotalBytes ? Math.round(memTotalBytes / 1048576) : 0;
  const diskUsedBytes = diskTotalBytes - diskFreeBytes;

  return {
    hardware_model:  h['summary.hardware.model'] ? xmlUnescape(h['summary.hardware.model']) : null,
    cpu_cores:       cpuCores || null,
    cpu_usage_pct:   cpuTotalMhz ? Math.round((cpuUsageMhz / cpuTotalMhz) * 1000) / 10 : null,
    memory_total_mb: memTotalMb || null,
    memory_used_mb:  memUsedMb || null,
    disk_total_gb:   diskTotalBytes ? Math.round(diskTotalBytes / 1073741824 * 10) / 10 : null,
    disk_used_gb:    diskTotalBytes ? Math.round(diskUsedBytes / 1073741824 * 10) / 10 : null,
    uptime_seconds:  bootTime && !isNaN(bootTime) ? Math.max(0, Math.floor((Date.now() - bootTime.getTime()) / 1000)) : null,
  };
}

async function getAllHostStats(hostname, port, username, password, verifySSL) {
  const { cookie, refs } = await soapLogin(hostname, port, username, password, verifySSL);
  try {
    const hostObjs = await soapRetrieveAll(hostname, port, verifySSL, cookie, refs, 'HostSystem', [
      'name', 'summary.hardware.model', 'summary.hardware.numCpuCores', 'summary.hardware.cpuMhz',
      'summary.quickStats.overallCpuUsage', 'summary.hardware.memorySize',
      'summary.quickStats.overallMemoryUsage', 'summary.runtime.bootTime', 'datastore',
    ]);
    if (!hostObjs.length) return [];

    // Fetch every datastore ONCE and share across hosts, rather than
    // per-host — hosts in the same cluster commonly share datastores.
    const anyDatastoreRefs = hostObjs.some(h => h.datastore);
    const datastoresByRef = new Map();
    if (anyDatastoreRefs) {
      const dsObjs = await soapRetrieveAll(hostname, port, verifySSL, cookie, refs, 'Datastore', [
        'summary.capacity', 'summary.freeSpace',
      ]);
      for (const d of dsObjs) if (d.__obj) datastoresByRef.set(d.__obj, d);
    }

    const results = [];
    for (const h of hostObjs) {
      const name = h.name ? xmlUnescape(h.name) : null;
      if (!name) continue;
      results.push({
        esxi_name: name,
        esxi_ip:   await resolveHostIp(name),
        ...computeHostStats(h, datastoresByRef),
      });
    }
    return results;
  } finally {
    try {
      await soapRequest(hostname, port, verifySSL,
        `<vim25:Logout><vim25:_this type="SessionManager">${xmlEscape(refs.sessionManager)}</vim25:_this></vim25:Logout>`,
        cookie);
    } catch { /* best-effort logout */ }
  }
}

async function discover(host, port, username, password, verifySSL) {
  let sessionId;
  try {
    sessionId = await createSession(host, port, username, password, verifySSL);
  } catch (err) {
    if (err instanceof VMwareAuthError) throw err;
    // No Automation REST API (standalone ESXi, or very old vCenter) — the
    // vim25 SOAP endpoint at /sdk is available on both.
    console.warn(`[vmware] REST session failed on ${host} (${err.message}) — falling back to SOAP /sdk`);
    return discoverViaSoap(host, port, username, password, verifySSL);
  }
  try {
    return await discoverWithSession(host, port, sessionId, verifySSL);
  } finally {
    if (sessionId) await destroySession(host, port, sessionId, verifySSL);
  }
}

module.exports = { discover, getAllHostStats, VMwareAuthError, VMwareConnectionError };
