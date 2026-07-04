/**
 * proxmoxService.js
 * -----------------
 * Connects to Proxmox VE (port 8006) and Proxmox Datacenter Manager / PDM (port 8007)
 * via the Proxmox REST API.  Collects VMs (QEMU/KVM) and containers (LXC):
 * name, node, status, IPs, OS, CPU/memory, disk, snapshots, tags, pool.
 *
 * Auth supports:
 *  - Ticket (password): POST /api2/json/access/ticket → PVEAuthCookie
 *  - API Token: Authorization: PVEAPIToken=user@realm!tokenid=secret (no session needed)
 */

const https = require('https');

class ProxmoxAuthError extends Error {}
class ProxmoxConnectionError extends Error {}

// ---------------------------------------------------------------------------
// Low-level HTTPS helper
// ---------------------------------------------------------------------------

function makeAgent(verifySSL) {
  return new https.Agent({ rejectUnauthorized: !!verifySSL });
}

function httpsReq({ hostname, port, path, method = 'GET', headers = {}, body, bodyType, verifySSL }) {
  return new Promise((resolve, reject) => {
    const agent = makeAgent(verifySSL);
    let bodyBuf = null;
    let contentType = 'application/json';

    if (body) {
      if (bodyType === 'form') {
        const str = new URLSearchParams(body).toString();
        bodyBuf = Buffer.from(str);
        contentType = 'application/x-www-form-urlencoded';
      } else {
        bodyBuf = Buffer.from(JSON.stringify(body));
      }
    }

    const req = https.request(
      {
        hostname, port, path, method, agent,
        headers: {
          ...(bodyBuf ? { 'Content-Type': contentType, 'Content-Length': bodyBuf.length } : {}),
          ...headers,
        },
      },
      (res) => {
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
      }
    );
    req.on('error', err =>
      reject(new ProxmoxConnectionError(`Cannot reach ${hostname}:${port} — ${err.message}`))
    );
    if (bodyBuf) req.write(bodyBuf);
    req.end();
  });
}

function parseData(raw) {
  try {
    const parsed = JSON.parse(raw);
    return parsed?.data !== undefined ? parsed.data : parsed;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Authenticated GET helpers
// ---------------------------------------------------------------------------

async function getWithTicket(hostname, port, path, ticket, verifySSL) {
  const { status, body } = await httpsReq({
    hostname, port, path, method: 'GET',
    headers: { Cookie: `PVEAuthCookie=${ticket}` },
    verifySSL,
  });
  if (status === 401 || status === 403) throw new ProxmoxAuthError(`Unauthorized at ${path}`);
  if (status >= 400) return null;
  return parseData(body);
}

async function getWithToken(hostname, port, path, tokenId, tokenSecret, verifySSL) {
  const { status, body } = await httpsReq({
    hostname, port, path, method: 'GET',
    headers: { Authorization: `PVEAPIToken=${tokenId}=${tokenSecret}` },
    verifySSL,
  });
  if (status === 401 || status === 403) throw new ProxmoxAuthError(`Unauthorized at ${path}`);
  if (status >= 400) return null;
  return parseData(body);
}

// ---------------------------------------------------------------------------
// Authentication
// ---------------------------------------------------------------------------

async function createTicket(hostname, port, username, realm, password, verifySSL) {
  const { status, body } = await httpsReq({
    hostname, port,
    path: '/api2/json/access/ticket',
    method: 'POST',
    body: { username: `${username}@${realm}`, password },
    bodyType: 'form',
    verifySSL,
  });
  if (status === 401) throw new ProxmoxAuthError(`Invalid credentials for ${username}@${realm}@${hostname}`);
  if (status !== 200) throw new ProxmoxConnectionError(`Failed to authenticate: HTTP ${status}`);
  const data = parseData(body);
  if (!data?.ticket) throw new ProxmoxAuthError('No ticket returned from Proxmox');
  return data.ticket;
}

// ---------------------------------------------------------------------------
// IP/MAC/disk extraction helpers
// ---------------------------------------------------------------------------

function extractQemuIPs(agentNet) {
  if (!agentNet) return ['Not Available'];
  const ifaces = agentNet.result || (Array.isArray(agentNet) ? agentNet : []);
  const ips = new Set();
  for (const iface of ifaces) {
    if ((iface.name || '') === 'lo') continue;
    for (const addr of (iface['ip-addresses'] || [])) {
      const ip = addr['ip-address'];
      if (ip && !ip.startsWith('127.') && !ip.startsWith('169.254') &&
          !ip.startsWith('fe80') && ip !== '::1') {
        ips.add(ip);
      }
    }
  }
  return ips.size ? [...ips] : ['Not Available'];
}

function extractLxcIPs(config) {
  if (!config) return ['Not Available'];
  const ips = new Set();
  for (const key of Object.keys(config)) {
    if (!key.startsWith('net')) continue;
    const val = config[key];
    if (typeof val !== 'string') continue;
    // net0 = name=eth0,bridge=vmbr0,ip=192.168.1.5/24,...
    const m = val.match(/(?:^|,)ip=([^,/]+)/);
    if (m && m[1] !== 'dhcp' && m[1] !== 'manual' && m[1] !== 'static') {
      ips.add(m[1]);
    }
  }
  return ips.size ? [...ips] : ['Not Available'];
}

function estimateQemuDiskGb(config) {
  if (!config) return null;
  for (const key of Object.keys(config)) {
    if (!/^(scsi|virtio|sata|ide|efidisk|tpmstate)\d+$/.test(key)) continue;
    const val = config[key];
    if (typeof val !== 'string') continue;
    const m = val.match(/size=(\d+(?:\.\d+)?)([KMGT]?)/i);
    if (!m) continue;
    const n = parseFloat(m[1]);
    const u = (m[2] || 'G').toUpperCase();
    if (u === 'G') return Math.round(n * 100) / 100;
    if (u === 'T') return Math.round(n * 1024 * 100) / 100;
    if (u === 'M') return Math.round(n / 1024 * 100) / 100;
  }
  return null;
}

function estimateLxcDiskGb(config) {
  if (!config?.rootfs || typeof config.rootfs !== 'string') return null;
  const m = config.rootfs.match(/size=(\d+(?:\.\d+)?)([KMGT]?)/i);
  if (!m) return null;
  const n = parseFloat(m[1]);
  const u = (m[2] || 'G').toUpperCase();
  if (u === 'G') return Math.round(n * 100) / 100;
  if (u === 'T') return Math.round(n * 1024 * 100) / 100;
  return null;
}

function processSnapshots(snaps) {
  const filtered = Array.isArray(snaps) ? snaps.filter(s => s.name !== 'current') : [];
  if (!filtered.length) return { snapshot_count: 0, snapshot_oldest: null };
  let oldest = null;
  for (const s of filtered) {
    const t = s.snaptime ? new Date(s.snaptime * 1000) : null;
    if (t && (!oldest || t < oldest)) oldest = t;
  }
  return {
    snapshot_count: filtered.length,
    snapshot_oldest: oldest ? oldest.toISOString().replace('T', ' ').slice(0, 19) + ' UTC' : null,
  };
}

function parseTags(tagStr) {
  if (!tagStr) return [];
  return tagStr.split(/[;,]/).map(t => t.trim()).filter(Boolean);
}

const OS_TYPE_MAP = {
  l24: 'Linux 2.4', l26: 'Linux', wxp: 'Windows XP',
  w2k: 'Windows 2000', w2k3: 'Windows Server 2003', w2k8: 'Windows Server 2008',
  wvista: 'Windows Vista', win7: 'Windows 7', win8: 'Windows 8',
  win10: 'Windows 10/11', win11: 'Windows 11', solaris: 'Solaris', other: 'Other',
};

function normalizeOsType(ostype) {
  if (!ostype) return null;
  return OS_TYPE_MAP[ostype] || ostype;
}

// ---------------------------------------------------------------------------
// Main discovery — Proxmox VE (ticket or token)
// ---------------------------------------------------------------------------

async function discoverVE(hostname, port, getter, verifySSL) {
  const nodes = await getter('/api2/json/nodes');
  if (!Array.isArray(nodes)) throw new Error('Could not retrieve nodes from Proxmox');

  const CONCURRENCY = 10;
  const inventory = [];

  for (const nodeInfo of nodes) {
    const node = nodeInfo.node;
    if (!node) continue;

    const [qemuList, lxcList] = await Promise.all([
      getter(`/api2/json/nodes/${node}/qemu`).then(r => Array.isArray(r) ? r : []),
      getter(`/api2/json/nodes/${node}/lxc`).then(r => Array.isArray(r) ? r : []),
    ]);

    // QEMU VMs
    for (let i = 0; i < qemuList.length; i += CONCURRENCY) {
      const batch = qemuList.slice(i, i + CONCURRENCY);
      const results = await Promise.all(batch.map(async (vm) => {
        try {
          const vmid = vm.vmid;
          const base  = `/api2/json/nodes/${node}/qemu/${vmid}`;
          const [config, snaps, agentNet] = await Promise.all([
            getter(`${base}/config`),
            getter(`${base}/snapshot`),
            vm.status === 'running' ? getter(`${base}/agent/network-get-interfaces`).catch(() => null) : null,
          ]);
          const { snapshot_count, snapshot_oldest } = processSnapshots(snaps);
          return {
            vmid,
            name:            vm.name || `VM-${vmid}`,
            vm_type:         'qemu',
            node,
            status:          vm.status || 'stopped',
            cpu_count:       config?.cores ? (config.cores * (config.sockets || 1)) : (vm.cpus || null),
            memory_mb:       config?.memory || (vm.maxmem ? Math.round(vm.maxmem / 1048576) : null),
            disk_gb:         estimateQemuDiskGb(config),
            ips:             extractQemuIPs(agentNet),
            os_type:         normalizeOsType(config?.ostype),
            uptime_seconds:  vm.uptime || 0,
            is_template:     !!(vm.template || config?.template),
            snapshot_count,
            snapshot_oldest,
            tags:            parseTags(config?.tags || vm.tags),
            pool:            vm.pool || null,
            cluster:         null,
          };
        } catch (err) {
          console.warn(`[proxmox] skipping QEMU ${vm.vmid}@${node}: ${err.message}`);
          return null;
        }
      }));
      for (const r of results) if (r) inventory.push(r);
    }

    // LXC containers
    for (let i = 0; i < lxcList.length; i += CONCURRENCY) {
      const batch = lxcList.slice(i, i + CONCURRENCY);
      const results = await Promise.all(batch.map(async (ct) => {
        try {
          const vmid = ct.vmid;
          const base  = `/api2/json/nodes/${node}/lxc/${vmid}`;
          const [config, snaps] = await Promise.all([
            getter(`${base}/config`),
            getter(`${base}/snapshot`),
          ]);
          const { snapshot_count, snapshot_oldest } = processSnapshots(snaps);
          return {
            vmid,
            name:            ct.name || `CT-${vmid}`,
            vm_type:         'lxc',
            node,
            status:          ct.status || 'stopped',
            cpu_count:       config?.cores || ct.cpus || null,
            memory_mb:       config?.memory || (ct.maxmem ? Math.round(ct.maxmem / 1048576) : null),
            disk_gb:         estimateLxcDiskGb(config),
            ips:             extractLxcIPs(config),
            os_type:         config?.ostype || null,
            uptime_seconds:  ct.uptime || 0,
            is_template:     !!(ct.template || config?.template),
            snapshot_count,
            snapshot_oldest,
            tags:            parseTags(config?.tags || ct.tags),
            pool:            ct.pool || null,
            cluster:         null,
          };
        } catch (err) {
          console.warn(`[proxmox] skipping LXC ${ct.vmid}@${node}: ${err.message}`);
          return null;
        }
      }));
      for (const r of results) if (r) inventory.push(r);
    }
  }

  return inventory;
}

// ---------------------------------------------------------------------------
// PDM discovery — tries aggregated PDM endpoints; falls back to VE style
// ---------------------------------------------------------------------------

async function discoverPDM(hostname, port, getter) {
  // PDM exposes aggregated cluster resources; try that first
  const resources = await getter('/api2/json/resources/vms').catch(() => null);
  if (Array.isArray(resources) && resources.length > 0) {
    return resources.map(vm => ({
      vmid:            vm.vmid,
      name:            vm.name || `VM-${vm.vmid}`,
      vm_type:         vm.type || 'qemu',
      node:            vm.node,
      status:          vm.status || 'stopped',
      cpu_count:       vm.cpus || null,
      memory_mb:       vm.maxmem ? Math.round(vm.maxmem / 1048576) : null,
      disk_gb:         vm.maxdisk ? Math.round(vm.maxdisk / 1073741824 * 100) / 100 : null,
      ips:             ['Not Available'],
      os_type:         null,
      uptime_seconds:  vm.uptime || 0,
      is_template:     !!vm.template,
      snapshot_count:  0,
      snapshot_oldest: null,
      tags:            parseTags(vm.tags),
      pool:            vm.pool || null,
      cluster:         vm.remote || vm.cluster || null,
    }));
  }
  // Fallback: treat PDM like a VE node
  return discoverVE(hostname, port, getter, false);
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

async function discover(host, port, username, realm, password, verifySSL, hostType = 've', tokenId = null, tokenSecret = null) {
  let getter;

  if (tokenId && tokenSecret) {
    // API token auth — no session needed
    getter = path => getWithToken(host, port, path, tokenId, tokenSecret, verifySSL);
  } else {
    const ticket = await createTicket(host, port, username, realm, password, verifySSL);
    getter = path => getWithTicket(host, port, path, ticket, verifySSL);
  }

  if (hostType === 'pdm') return discoverPDM(host, port, getter);
  return discoverVE(host, port, getter, verifySSL);
}

module.exports = { discover, ProxmoxAuthError, ProxmoxConnectionError };
