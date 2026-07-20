/**
 * hypervService.js
 * ----------------
 * Connects to Hyper-V hosts via WinRM by shelling out to PowerShell (pwsh),
 * which handles the Negotiate/Kerberos/NTLM/CredSSP handshake natively.
 *
 * A previous version of this file hand-rolled the WS-Management SOAP
 * protocol directly over HTTP with a custom NTLM implementation. That only
 * ever worked against hosts configured for bare NTLM or Basic auth — the
 * out-of-the-box `Enable-PSRemoting -Force` configuration on modern Windows
 * hosts advertises "Negotiate, Kerberos, CredSSP" (SPNEGO-wrapped), which a
 * bare "Authorization: NTLM ..." header doesn't satisfy, and reimplementing
 * SPNEGO/Kerberos from scratch in Node.js isn't worth it when PowerShell's
 * own WSMan client already does this correctly.
 *
 * Requires PowerShell (pwsh) installed on this server:
 *   https://learn.microsoft.com/powershell/scripting/install/installing-powershell-on-linux
 *
 * On the target Hyper-V host, WinRM must be enabled:
 *   Enable-PSRemoting -Force
 */

const { spawn } = require('child_process');

// ── PowerShell discovery script (runs ON the remote Hyper-V host) ────────────

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

// ── PowerShell wrapper — connects to the remote host and runs a scriptblock ──

function psSingleQuote(str) {
  // PowerShell single-quoted strings only need '' to escape a literal '
  return `'${String(str).replace(/'/g, "''")}'`;
}

function buildWrapperScript(cfg, remoteScriptEnvVar) {
  const useSSL   = !!cfg.useSSL;
  const port     = cfg.port || (useSSL ? 5986 : 5985);
  const skipCert = useSSL && !cfg.verifySSL;

  return `
$ErrorActionPreference = 'Stop'
try {
  $securePass = ConvertTo-SecureString $env:HYPERV_PASS -AsPlainText -Force
  $cred = New-Object System.Management.Automation.PSCredential($env:HYPERV_USER, $securePass)
  ${skipCert ? '$sessionOpt = New-PSSessionOption -SkipCACheck -SkipCNCheck -SkipRevocationCheck' : '$sessionOpt = New-PSSessionOption'}
  $remoteScript = [ScriptBlock]::Create($env:${remoteScriptEnvVar})
  $icmParams = @{
    ComputerName  = ${psSingleQuote(cfg.host)}
    Port          = ${port}
    Credential    = $cred
    SessionOption = $sessionOpt
    ScriptBlock   = $remoteScript
    ErrorAction   = 'Stop'
  }
  ${useSSL ? '$icmParams.UseSSL = $true' : ''}
  $result = Invoke-Command @icmParams
  $result | ConvertTo-Json -Compress -Depth 6
} catch {
  [Console]::Error.WriteLine($_.Exception.Message)
  exit 1
}
`;
}

// Strip ANSI/VT100 CSI escape sequences (e.g. \x1b[?1h / \x1b[?1l cursor-key
// mode toggles). pwsh's console host emits these even with -NonInteractive
// when the script is piped in via stdin, contaminating stdout enough to
// break JSON parsing — passing the script as -EncodedCommand avoids that
// console-host initialization in the first place, but this is kept as a
// defensive second layer in case anything else ever leaks through.
function stripAnsi(str) {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '');
}

function runPwsh(cfg, remoteScript) {
  return new Promise((resolve, reject) => {
    const wrapper = buildWrapperScript(cfg, 'HYPERV_SCRIPT');
    const encoded = Buffer.from(wrapper, 'utf16le').toString('base64');
    const child = spawn('pwsh', ['-NonInteractive', '-NoProfile', '-EncodedCommand', encoded], {
      env: {
        ...process.env,
        TERM:          'dumb',
        HYPERV_USER:   cfg.username || '',
        HYPERV_PASS:   cfg.password || '',
        HYPERV_SCRIPT: remoteScript,
      },
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', d => { stdout += d; });
    child.stderr.on('data', d => { stderr += d; });

    child.on('error', (e) => {
      if (e.code === 'ENOENT') {
        reject(new Error('PowerShell (pwsh) is not installed on this server. Install it and retry — see https://learn.microsoft.com/powershell/scripting/install/installing-powershell-on-linux'));
      } else {
        reject(new Error(`Failed to launch pwsh: ${e.message}`));
      }
    });

    child.on('close', (code) => {
      const cleanOut = stripAnsi(stdout).trim();
      if (code !== 0) {
        const msg = stripAnsi(stderr).trim() || `pwsh exited with code ${code}`;
        reject(new Error(msg));
      } else {
        resolve(cleanOut);
      }
    });

    child.stdin.end();
  });
}

// ── Public API ────────────────────────────────────────────────────────────────

async function testConnection(cfg) {
  try {
    const out = await runPwsh(cfg, '(Get-VM | Measure-Object).Count');
    const count = parseInt(out.trim(), 10);
    return { ok: true, vmCount: isNaN(count) ? 0 : count };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

async function discoverVMs(cfg) {
  const raw = await runPwsh(cfg, DISCOVERY_SCRIPT);
  return parseVMs(raw);
}

module.exports = { testConnection, discoverVMs };
