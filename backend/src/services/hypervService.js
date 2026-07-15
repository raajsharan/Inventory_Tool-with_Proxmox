/**
 * hypervService.js
 * ----------------
 * Connects to Hyper-V hosts via WinRM (WS-Management over HTTP/HTTPS).
 * Supports both NTLM (Windows default) and Basic authentication.
 *
 * WinRM must be enabled on the target host:
 *   Enable-PSRemoting -Force
 *
 * For NTLM (default — no extra config needed on the host):
 *   Works out of the box with domain or local accounts.
 *
 * For Basic auth (optional alternative):
 *   Set-Item WSMan:\localhost\Service\Auth\Basic $true
 *   Set-Item WSMan:\localhost\Service\AllowUnencrypted $true  # HTTP only
 */

const http  = require('http');
const https = require('https');
const { v4: uuidv4 } = require('uuid');
const { buildType1, parseType2, buildType3, parseUsername } = require('../utils/ntlm');

// ── WS-Management namespaces ──────────────────────────────────────────────────
const NS_ADDR  = 'http://schemas.xmlsoap.org/ws/2004/08/addressing';
const NS_SHELL = 'http://schemas.microsoft.com/wbem/wsman/1/windows/shell/cmd';
const NS_WSMAN = 'http://schemas.dmtf.org/wbem/wsman/1/wsman.xsd';
const NS_RSP   = 'http://schemas.microsoft.com/wbem/wsman/1/windows/shell';

// ── SOAP helpers ──────────────────────────────────────────────────────────────

function soapHeader(action, shellId) {
  const sel = shellId
    ? `<w:SelectorSet><w:Selector Name="ShellId">${shellId}</w:Selector></w:SelectorSet>`
    : '';
  return `
  <s:Header>
    <a:To>HTTP://placeholder</a:To>
    <w:ResourceURI s:mustUnderstand="true">${NS_SHELL}</w:ResourceURI>
    <a:ReplyTo><a:Address s:mustUnderstand="true">${NS_ADDR}/role/anonymous</a:Address></a:ReplyTo>
    <a:Action s:mustUnderstand="true">${action}</a:Action>
    <w:MaxEnvelopeSize s:mustUnderstand="true">512000</w:MaxEnvelopeSize>
    <a:MessageID>uuid:${uuidv4()}</a:MessageID>
    <w:Locale xml:lang="en-US" s:mustUnderstand="false"/>
    <p:DataLocale xml:lang="en-US" s:mustUnderstand="false" xmlns:p="${NS_WSMAN}"/>
    <w:OperationTimeout>PT120S</w:OperationTimeout>
    ${sel}
  </s:Header>`;
}

function envelope(header, body) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope"
            xmlns:a="${NS_ADDR}"
            xmlns:w="${NS_WSMAN}"
            xmlns:rsp="${NS_RSP}">
${header}
  <s:Body>${body}</s:Body>
</s:Envelope>`;
}

// ── Low-level HTTP transport ──────────────────────────────────────────────────

function httpRequest(proto, opts, bodyBuf) {
  return new Promise((resolve, reject) => {
    const req = proto.request(opts, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({
        status:  res.statusCode,
        headers: res.headers,
        body:    Buffer.concat(chunks).toString('utf8'),
      }));
    });
    req.on('error', e => reject(new Error(`WinRM connection to ${opts.hostname}:${opts.port} failed — ${e.message}`)));
    req.setTimeout(30000, () => { req.destroy(); reject(new Error('WinRM request timed out after 30s')); });
    if (bodyBuf && bodyBuf.length) req.write(bodyBuf);
    req.end();
  });
}

// ── NTLM-authenticated POST ───────────────────────────────────────────────────

async function winrmPost(cfg, soapBody) {
  const proto   = cfg.useSSL ? https : http;
  const port    = cfg.port   || (cfg.useSSL ? 5986 : 5985);
  const soapBuf = Buffer.from(soapBody, 'utf8');

  // Keep-alive agent: ensures Type1 and Type3 go over the SAME TCP socket
  const agentOpts = { keepAlive: true, maxSockets: 1 };
  if (cfg.useSSL) agentOpts.rejectUnauthorized = !!cfg.verifySSL;
  const agent = new proto.Agent(agentOpts);

  const base = {
    hostname: cfg.host,
    port,
    path:     '/wsman',
    method:   'POST',
    agent,
  };

  const { username, domain } = parseUsername(cfg.username);

  // ── Step 1: NTLM Type 1 (Negotiate) ─────────────────────────────────────
  const type1b64 = buildType1().toString('base64');
  const res1 = await httpRequest(proto, {
    ...base,
    headers: {
      'Authorization':  `NTLM ${type1b64}`,
      'Content-Type':   'application/soap+xml;charset=UTF-8',
      'Content-Length': 0,
      'Connection':     'keep-alive',
    },
  }, null);

  if (res1.status !== 401) {
    // Server accepted without challenge (unlikely) or failed for other reason
    if (res1.status === 200 || res1.status === 201) return res1;
    const hint = buildHint(res1.status, res1.headers['www-authenticate'] || '');
    throw new Error(`WinRM CreateShell failed (HTTP ${res1.status}): ${hint}`);
  }

  // ── Step 2: Parse NTLM Type 2 challenge ─────────────────────────────────
  const wwwAuth  = res1.headers['www-authenticate'] || '';
  const ntlmPart = wwwAuth.match(/(?:^|,)\s*NTLM\s+([A-Za-z0-9+/=]+)/i);
  const negoPart = wwwAuth.match(/(?:^|,)\s*Negotiate\s+([A-Za-z0-9+/=]+)/i);
  const challenge = ntlmPart || negoPart;

  if (!challenge) {
    // Server returned 401 but no NTLM challenge — check if Basic is offered
    if (/Basic/i.test(wwwAuth)) {
      return winrmBasic(proto, base, soapBuf, cfg.username, cfg.password);
    }
    throw new Error(
      `WinRM 401 — server offered: "${wwwAuth || '(none)'}". ` +
      `Enable WinRM on the host: run  Enable-PSRemoting -Force  as Administrator.`
    );
  }

  const type2Buf = Buffer.from(challenge[1], 'base64');
  const { serverChallenge } = parseType2(type2Buf);

  // ── Step 3: NTLM Type 3 (Authenticate) + actual SOAP body ───────────────
  const type3b64 = buildType3(username, cfg.password, domain, serverChallenge).toString('base64');
  const res2 = await httpRequest(proto, {
    ...base,
    headers: {
      'Authorization':  `NTLM ${type3b64}`,
      'Content-Type':   'application/soap+xml;charset=UTF-8',
      'Content-Length': soapBuf.length,
      'Connection':     'keep-alive',
    },
  }, soapBuf);

  // Destroy the agent after we're done — we create a fresh one per call
  agent.destroy();

  if (res2.status !== 200 && res2.status !== 201) {
    const hint = buildHint(res2.status, res2.headers['www-authenticate'] || '');
    throw new Error(`WinRM request failed (HTTP ${res2.status}): ${hint}`);
  }
  return res2;
}

async function winrmBasic(proto, base, soapBuf, username, password) {
  const auth = Buffer.from(`${username}:${password}`).toString('base64');
  const res  = await httpRequest(proto, {
    ...base,
    headers: {
      'Authorization':  `Basic ${auth}`,
      'Content-Type':   'application/soap+xml;charset=UTF-8',
      'Content-Length': soapBuf.length,
    },
  }, soapBuf);
  if (res.status !== 200 && res.status !== 201) {
    throw new Error(`WinRM Basic auth failed (HTTP ${res.status}) — check username/password.`);
  }
  return res;
}

function buildHint(status, wwwAuth) {
  if (status === 401) {
    if (!wwwAuth) return 'No WWW-Authenticate header. Run Enable-PSRemoting -Force on the host.';
    if (/Negotiate|NTLM/i.test(wwwAuth)) return 'NTLM authentication failed — check username and password.';
    return `Authentication rejected (${wwwAuth}) — check credentials.`;
  }
  if (status === 403) return 'Access denied — ensure the user has permission to run remote PS commands.';
  if (status === 500) return 'WinRM internal error — check Windows Event Log on the host.';
  return '';
}

// ── WinRM shell helpers ───────────────────────────────────────────────────────

function extractShellId(xml) {
  const m = xml.match(/Selector Name="ShellId">([\w-]+)</i);
  return m ? m[1] : null;
}

function extractCommandId(xml) {
  const m = xml.match(/<rsp:CommandId>([\w-]+)<\/rsp:CommandId>/i);
  return m ? m[1] : null;
}

function extractOutput(xml) {
  return [...xml.matchAll(/<rsp:Stream Name="stdout"[^>]*>([^<]*)<\/rsp:Stream>/gi)]
    .map(m => Buffer.from(m[1], 'base64').toString('utf8'))
    .join('');
}

function isDone(xml) {
  return xml.includes('CommandState') && xml.includes('Done');
}

// ── High-level WinRM session ──────────────────────────────────────────────────

async function runPowerShell(cfg, psScript) {
  // CreateShell
  const createXml = envelope(
    soapHeader(`${NS_ADDR}/transfer/Create`, null),
    `<rsp:Shell><rsp:InputStreams>stdin</rsp:InputStreams><rsp:OutputStreams>stdout stderr</rsp:OutputStreams></rsp:Shell>`
  );
  const createRes = await winrmPost(cfg, createXml);
  const shellId = extractShellId(createRes.body);
  if (!shellId) throw new Error('Could not extract ShellId from WinRM response');

  try {
    // Execute powershell via EncodedCommand (avoids XML escaping issues)
    const encoded = Buffer.from(psScript, 'utf16le').toString('base64');
    const cmd     = `powershell -NonInteractive -NoProfile -ExecutionPolicy Bypass -EncodedCommand ${encoded}`;
    const escapedCmd = cmd.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

    const execXml = envelope(
      soapHeader(`${NS_RSP}/Command`, shellId),
      `<rsp:CommandLine><rsp:Command>${escapedCmd}</rsp:Command></rsp:CommandLine>`
    );
    const execRes = await winrmPost(cfg, execXml);
    if (execRes.status !== 200) throw new Error(`WinRM Execute failed (HTTP ${execRes.status})`);

    const cmdId = extractCommandId(execRes.body);
    if (!cmdId) throw new Error('Could not extract CommandId from WinRM response');

    // Receive output (loop until Done)
    let output = '';
    for (let i = 0; i < 60; i++) {
      const recvXml = envelope(
        soapHeader(`${NS_RSP}/Receive`, shellId),
        `<rsp:Receive><rsp:DesiredStream CommandId="${cmdId}">stdout stderr</rsp:DesiredStream></rsp:Receive>`
      );
      const recvRes = await winrmPost(cfg, recvXml);
      output += extractOutput(recvRes.body);
      if (isDone(recvRes.body)) break;
      await new Promise(r => setTimeout(r, 1000));
    }
    return output;
  } finally {
    // DeleteShell (best-effort)
    const delXml = envelope(soapHeader(`${NS_ADDR}/transfer/Delete`, shellId), '');
    await winrmPost(cfg, delXml).catch(() => {});
  }
}

// ── PowerShell discovery script ───────────────────────────────────────────────

const DISCOVERY_SCRIPT = `
$ErrorActionPreference = 'SilentlyContinue'
$vms = Get-VM | ForEach-Object {
  $vm = $_
  $adapters = Get-VMNetworkAdapter -VM $vm
  $ips  = @($adapters | ForEach-Object { $_.IPAddresses } | Where-Object { $_ -match '^\\d' })
  $macs = @($adapters | ForEach-Object { $_.MacAddress })
  $snaps  = @(Get-VMSnapshot -VM $vm)
  $oldest = if ($snaps.Count -gt 0) { ($snaps | Sort-Object CreationTime | Select-Object -First 1).CreationTime.ToString('o') } else { $null }
  $disks  = @(Get-VMHardDiskDrive -VM $vm)
  $diskGB = 0
  foreach ($d in $disks) { try { $diskGB += (Get-VHD -Path $d.Path).FileSize / 1GB } catch {} }
  $osName = ''
  try { $info = Get-WmiObject -Class Win32_OperatingSystem -ComputerName $vm.VMName -ErrorAction Stop; $osName = $info.Caption } catch {}
  [PSCustomObject]@{
    VmId           = $vm.VMId.ToString()
    Name           = $vm.VMName
    State          = $vm.State.ToString()
    Generation     = $vm.Generation
    CpuCount       = $vm.ProcessorCount
    MemoryMB       = [math]::Round($vm.MemoryStartup / 1MB)
    MemoryType     = if ($vm.DynamicMemoryEnabled) { 'Dynamic' } else { 'Static' }
    DiskGB         = [math]::Round($diskGB, 2)
    IPs            = $ips
    MacAddresses   = $macs
    OsName         = $osName
    OsType         = if ($osName -match 'Windows') { 'Windows' } elseif ($osName -match 'Linux') { 'Linux' } else { 'Unknown' }
    UptimeSeconds  = [math]::Round($vm.Uptime.TotalSeconds)
    SnapshotCount  = $snaps.Count
    SnapshotOldest = $oldest
  }
}
if ($vms) { $vms | ConvertTo-Json -Compress -Depth 5 } else { '[]' }
`;

function parseVMs(raw) {
  const text = raw.trim();
  if (!text || text === '[]') return [];
  try {
    const parsed = JSON.parse(text);
    const arr = Array.isArray(parsed) ? parsed : [parsed];
    return arr.map(v => ({
      vm_id:           v.VmId          || '',
      name:            v.Name          || '',
      state:           v.State         || '',
      generation:      v.Generation    || null,
      cpu_count:       v.CpuCount      || null,
      memory_mb:       v.MemoryMB      || null,
      memory_type:     v.MemoryType    || null,
      disk_gb:         v.DiskGB        || null,
      ips:             Array.isArray(v.IPs) ? v.IPs : (v.IPs ? [v.IPs] : []),
      mac_addresses:   Array.isArray(v.MacAddresses) ? v.MacAddresses : (v.MacAddresses ? [v.MacAddresses] : []),
      os_name:         v.OsName        || null,
      os_type:         v.OsType        || 'Unknown',
      uptime_seconds:  v.UptimeSeconds || null,
      is_template:     false,
      snapshot_count:  v.SnapshotCount || 0,
      snapshot_oldest: v.SnapshotOldest || null,
    }));
  } catch (e) {
    throw new Error(`Failed to parse VM JSON from PowerShell: ${e.message}\nOutput: ${text.slice(0, 500)}`);
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

async function testConnection(cfg) {
  try {
    const out = await runPowerShell(cfg, `(Get-VM | Measure-Object).Count`);
    const count = parseInt(out.trim(), 10);
    return { ok: true, vmCount: isNaN(count) ? 0 : count };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

async function discoverVMs(cfg) {
  const raw = await runPowerShell(cfg, DISCOVERY_SCRIPT);
  return parseVMs(raw);
}

module.exports = { testConnection, discoverVMs };
