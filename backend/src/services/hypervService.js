/**
 * hypervService.js
 * ----------------
 * Connects to Microsoft Hyper-V hosts via WinRM (WS-Management over HTTP/HTTPS)
 * using Basic authentication and runs PowerShell commands to discover VMs.
 *
 * Prerequisites on the Windows host:
 *   Enable-PSRemoting -Force
 *   Set-Item WSMan:\localhost\Service\Auth\Basic $true
 *   # For HTTP (port 5985 — dev/trusted networks only):
 *   Set-Item WSMan:\localhost\Service\AllowUnencrypted $true
 *   # For HTTPS (port 5986 — recommended for production):
 *   # Configure a WinRM HTTPS listener with a valid certificate.
 */

const http  = require('http');
const https = require('https');
const { v4: uuidv4 } = require('uuid');

// ---------------------------------------------------------------------------
// WinRM SOAP helpers
// ---------------------------------------------------------------------------

const WSMAN_ADDR  = 'http://schemas.xmlsoap.org/ws/2004/08/addressing';
const WSMAN_SHELL = 'http://schemas.microsoft.com/wbem/wsman/1/windows/shell/cmd';
const WSMAN_NS    = 'http://schemas.dmtf.org/wbem/wsman/1/wsman.xsd';
const RSP_NS      = 'http://schemas.microsoft.com/wbem/wsman/1/windows/shell';

function soapHeader(action, shellId, msgId) {
  const selSet = shellId
    ? `<w:SelectorSet><w:Selector Name="ShellId">${shellId}</w:Selector></w:SelectorSet>`
    : '';
  return `
  <s:Header>
    <a:To>HTTP://placeholder</a:To>
    <w:ResourceURI s:mustUnderstand="true">${WSMAN_SHELL}</w:ResourceURI>
    <a:ReplyTo><a:Address s:mustUnderstand="true">${WSMAN_ADDR}/role/anonymous</a:Address></a:ReplyTo>
    <a:Action s:mustUnderstand="true">${action}</a:Action>
    <w:MaxEnvelopeSize s:mustUnderstand="true">512000</w:MaxEnvelopeSize>
    <a:MessageID>uuid:${msgId}</a:MessageID>
    <w:Locale xml:lang="en-US" s:mustUnderstand="false"/>
    <p:DataLocale xml:lang="en-US" s:mustUnderstand="false" xmlns:p="${WSMAN_NS}"/>
    <w:OperationTimeout>PT120S</w:OperationTimeout>
    ${selSet}
  </s:Header>`;
}

function soapEnvelope(header, body) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope"
            xmlns:a="${WSMAN_ADDR}"
            xmlns:w="${WSMAN_NS}"
            xmlns:rsp="${RSP_NS}">
${header}
  <s:Body>${body}</s:Body>
</s:Envelope>`;
}

function createShellBody() {
  return `<rsp:Shell><rsp:InputStreams>stdin</rsp:InputStreams><rsp:OutputStreams>stdout stderr</rsp:OutputStreams></rsp:Shell>`;
}

function executeCommandBody(command) {
  const escaped = command.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  return `<rsp:CommandLine><rsp:Command>${escaped}</rsp:Command></rsp:CommandLine>`;
}

function receiveBody(cmdId) {
  return `<rsp:Receive><rsp:DesiredStream CommandId="${cmdId}">stdout stderr</rsp:DesiredStream></rsp:Receive>`;
}

function deleteShellBody() { return ''; }

// ---------------------------------------------------------------------------
// HTTP transport
// ---------------------------------------------------------------------------

function winrmPost(cfg, body) {
  return new Promise((resolve, reject) => {
    const auth   = Buffer.from(`${cfg.username}:${cfg.password}`).toString('base64');
    const buf    = Buffer.from(body, 'utf8');
    const proto  = cfg.useSSL ? https : http;
    const agent  = cfg.useSSL ? new https.Agent({ rejectUnauthorized: !!cfg.verifySSL }) : undefined;

    const opts = {
      hostname: cfg.host,
      port:     cfg.port || (cfg.useSSL ? 5986 : 5985),
      path:     '/wsman',
      method:   'POST',
      agent,
      headers:  {
        'Content-Type':   'application/soap+xml;charset=UTF-8',
        'Content-Length': buf.length,
        'Authorization':  `Basic ${auth}`,
      },
    };

    const req = proto.request(opts, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', err => reject(new Error(`WinRM connection to ${cfg.host}:${opts.port} failed — ${err.message}`)));
    req.setTimeout(30000, () => { req.destroy(); reject(new Error('WinRM request timed out')); });
    req.write(buf);
    req.end();
  });
}

function extractXmlValue(xml, tag) {
  const m = xml.match(new RegExp(`<[^>]*${tag}[^>]*>([\\s\\S]*?)<\\/[^>]*${tag}>`, 'i'));
  return m ? m[1].trim() : null;
}

function extractShellId(xml) {
  const m = xml.match(/Selector Name="ShellId">([\w-]+)</i);
  return m ? m[1] : null;
}

function extractCommandId(xml) {
  const m = xml.match(/<rsp:CommandId>([\w-]+)<\/rsp:CommandId>/i);
  return m ? m[1] : null;
}

function extractOutput(xml) {
  const matches = [...xml.matchAll(/<rsp:Stream Name="stdout"[^>]*>([^<]*)<\/rsp:Stream>/gi)];
  return matches.map(m => Buffer.from(m[1], 'base64').toString('utf8')).join('');
}

function isDone(xml) {
  return xml.includes('CommandState') && xml.includes('Done');
}

// ---------------------------------------------------------------------------
// High-level WinRM session
// ---------------------------------------------------------------------------

async function runPowerShell(cfg, psScript) {
  const createEnv = soapEnvelope(
    soapHeader(`${WSMAN_ADDR}/transfer/Create`, null, uuidv4()),
    createShellBody()
  );

  const createRes = await winrmPost(cfg, createEnv);
  if (createRes.status !== 200 && createRes.status !== 201) {
    throw new Error(`WinRM CreateShell failed (HTTP ${createRes.status}): ${createRes.body.slice(0, 400)}`);
  }

  const shellId = extractShellId(createRes.body);
  if (!shellId) throw new Error('Could not extract ShellId from WinRM response');

  try {
    const cmd = `powershell -NonInteractive -NoProfile -ExecutionPolicy Bypass -EncodedCommand ${
      Buffer.from(psScript, 'utf16le').toString('base64')
    }`;

    const execEnv = soapEnvelope(
      soapHeader(`${RSP_NS}/Command`, shellId, uuidv4()),
      executeCommandBody(cmd)
    );
    const execRes = await winrmPost(cfg, execEnv);
    if (execRes.status !== 200) {
      throw new Error(`WinRM Execute failed (HTTP ${execRes.status})`);
    }
    const cmdId = extractCommandId(execRes.body);
    if (!cmdId) throw new Error('Could not extract CommandId from WinRM response');

    let output = '';
    let attempts = 0;
    while (attempts++ < 60) {
      const recvEnv = soapEnvelope(
        soapHeader(`${RSP_NS}/Receive`, shellId, uuidv4()),
        receiveBody(cmdId)
      );
      const recvRes = await winrmPost(cfg, recvEnv);
      output += extractOutput(recvRes.body);
      if (isDone(recvRes.body)) break;
      await new Promise(r => setTimeout(r, 1000));
    }
    return output;
  } finally {
    const delEnv = soapEnvelope(
      soapHeader(`${WSMAN_ADDR}/transfer/Delete`, shellId, uuidv4()),
      deleteShellBody()
    );
    await winrmPost(cfg, delEnv).catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// PowerShell discovery script
// ---------------------------------------------------------------------------

const DISCOVERY_SCRIPT = `
$ErrorActionPreference = 'SilentlyContinue'
$vms = Get-VM | ForEach-Object {
  $vm = $_
  $adapters = Get-VMNetworkAdapter -VM $vm
  $ips = @($adapters | ForEach-Object { $_.IPAddresses } | Where-Object { $_ -match '^\\d' })
  $macs = @($adapters | ForEach-Object { $_.MacAddress })
  $snaps = @(Get-VMSnapshot -VM $vm)
  $oldest = if ($snaps.Count -gt 0) { ($snaps | Sort-Object CreationTime | Select-Object -First 1).CreationTime.ToString('o') } else { $null }
  $disks = @(Get-VMHardDiskDrive -VM $vm)
  $diskGB = 0
  foreach ($d in $disks) {
    try { $diskGB += (Get-VHD -Path $d.Path).FileSize / 1GB } catch {}
  }
  $osName = ''
  try { $osName = (Get-VMIntegrationService -VM $vm -Name 'Guest Service Interface').PrimaryStatusDescription } catch {}
  $cluster = ''
  try { $cluster = (Get-ClusterResource | Where-Object { $_.Name -eq $vm.Name }).OwnerGroup.Name } catch {}
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
    IsTemplate     = $false
    SnapshotCount  = $snaps.Count
    SnapshotOldest = $oldest
    Cluster        = $cluster
  }
}
$vms | ConvertTo-Json -Compress -Depth 5
`;

function parseVMs(raw) {
  const text = raw.trim();
  if (!text) return [];
  try {
    const parsed = JSON.parse(text);
    const arr = Array.isArray(parsed) ? parsed : [parsed];
    return arr.map(v => ({
      vm_id:          v.VmId   || '',
      name:           v.Name   || '',
      state:          v.State  || '',
      generation:     v.Generation || null,
      cpu_count:      v.CpuCount || null,
      memory_mb:      v.MemoryMB || null,
      memory_type:    v.MemoryType || null,
      disk_gb:        v.DiskGB || null,
      ips:            Array.isArray(v.IPs) ? v.IPs : (v.IPs ? [v.IPs] : []),
      mac_addresses:  Array.isArray(v.MacAddresses) ? v.MacAddresses : (v.MacAddresses ? [v.MacAddresses] : []),
      os_name:        v.OsName || null,
      os_type:        v.OsType || 'Unknown',
      uptime_seconds: v.UptimeSeconds || null,
      is_template:    false,
      snapshot_count: v.SnapshotCount || 0,
      snapshot_oldest:v.SnapshotOldest || null,
      cluster:        v.Cluster || null,
    }));
  } catch (e) {
    throw new Error(`Failed to parse VM JSON from PowerShell output: ${e.message}\nOutput: ${text.slice(0, 500)}`);
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

async function testConnection(cfg) {
  const script = `$h = Get-Host; Write-Output "OK:$($h.Version)"`;
  try {
    const out = await runPowerShell(cfg, script);
    const vmsOut = await runPowerShell(cfg, `(Get-VM | Measure-Object).Count`);
    const count = parseInt(vmsOut.trim(), 10);
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
