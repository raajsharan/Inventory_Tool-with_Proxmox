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
 * Also requires the native WSMan client library (pwsh on Linux doesn't ship
 * with WinRM/PSRemoting support out of the box):
 *   sudo pwsh -Command "Set-PSRepository -Name PSGallery -InstallationPolicy Trusted; Install-Module -Name PSWSMan -Scope AllUsers -Force; Install-WSMan"
 *
 * If hosts are authenticated with local accounts (e.g. ".\Administrator")
 * rather than domain/Kerberos accounts, NTLM is used under Negotiate — the
 * Linux WSMan client needs the separate `gss-ntlmssp` GSSAPI plugin for
 * that, since Linux's GSSAPI stack (MIT Kerberos/Heimdal) doesn't include
 * NTLM support by default:
 *   sudo apt install gssntlmssp
 * Without it, connections to non-domain-joined hosts using local admin
 * credentials fail even though PSWSMan itself is correctly installed.
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
  # Only query the guest OS over the network for running VMs — a WMI call
  # to a powered-off VM's hostname has nothing to respond and hangs until a
  # slow RPC/DCOM timeout, which for several off VMs in a row can blow past
  # the whole session's operation timeout and abort discovery partway
  # through (silently dropping every VM after the one that was mid-timeout).
  if ($vm.State.ToString() -eq 'Running') {
    try { $info = Get-WmiObject -Class Win32_OperatingSystem -ComputerName $vm.VMName -ErrorAction Stop; $osName = $info.Caption } catch {}
  }
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
# Return the raw collection — do NOT ConvertTo-Json here. The outer wrapper
# script (buildWrapperScript) already serializes whatever this scriptblock
# returns via Invoke-Command; converting to JSON here too double-encodes it
# into a JSON string of a JSON string, which JSON.parse() on the Node side
# then unwraps into a single opaque string (not the VM array), collapsing
# every discovered VM into one blank record.
@($vms)
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
  ${skipCert ? '$sessionOpt = New-PSSessionOption -SkipCACheck -SkipCNCheck' : '$sessionOpt = New-PSSessionOption'}
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
        let msg = stripAnsi(stderr).trim() || `pwsh exited with code ${code}`;
        if (/no supported WSMan client library/i.test(msg)) {
          msg += ' — pwsh on Linux needs the native WSMan library installed separately. ' +
            'Run once on this server: sudo pwsh -Command "Set-PSRepository -Name PSGallery ' +
            '-InstallationPolicy Trusted; Install-Module -Name PSWSMan -Scope AllUsers -Force; Install-WSMan"';
        } else if (/gss|ntlm|negotiate/i.test(msg) && /(auth|credential|denied|failed)/i.test(msg)) {
          msg += ' — if this host uses a local account (not a domain/Kerberos account), the Linux ' +
            'WSMan client needs the gss-ntlmssp package for NTLM support. Run once on this server: ' +
            'sudo apt install gssntlmssp';
        }
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
