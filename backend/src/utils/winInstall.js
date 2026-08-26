const { execFile } = require('child_process');
const path = require('path');
const fs   = require('fs');

// Both New-PSSession (WinRM) and Invoke-WmiMethod need a real PowerShell
// binary. On native Windows that's powershell.exe; on this server's actual
// Linux deployment it's PowerShell Core (pwsh) — see hypervService.js for
// the same requirement (PSWSMan module for WinRM, gss-ntlmssp for NTLM/local
// accounts). Hardcoding "powershell.exe" here always failed with ENOENT on
// Linux, which is why WinRM/WMI install+verify never actually worked in
// production even though SSH/PsExec did.
const PS_BIN = process.platform === 'win32' ? 'powershell.exe' : 'pwsh';

// PowerShell serializes terminating errors that cross a remoting/redirect
// boundary (e.g. New-PSDrive/Invoke-WmiMethod failures under -EncodedCommand)
// into "CLIXML" — a "#< CLIXML" marker followed by an XML blob where every
// character outside plain ASCII, including ANSI colour codes, is escaped as
// "_xHHHH_". Decode it into the plain-text message PowerShell actually meant
// to show, instead of leaving that unreadable in the output box.
function decodeCliXml(raw) {
  const idx = raw.indexOf('#< CLIXML');
  if (idx < 0) return null;
  const xmlPart = raw.slice(idx);
  const lines = [...xmlPart.matchAll(/<S[^>]*>([\s\S]*?)<\/S>/g)].map(m => m[1]);
  if (!lines.length) return null;
  const text = lines.join('')
    .replace(/_x([0-9A-Fa-f]{4})_/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    // eslint-disable-next-line no-control-regex
    .replace(/\x1b\[[0-9;]*m/g, '') // drop ANSI colour codes the escape above just revealed
    .trim();
  return text || null;
}

// Replaces a raw CLIXML blob in captured output with its decoded text, so
// the transcript shown to the user stays readable end to end instead of
// switching to unreadable escape codes partway through.
function cleanPsOutput(raw) {
  const idx = raw.indexOf('#< CLIXML');
  if (idx < 0) return raw;
  const decoded = decodeCliXml(raw);
  return raw.slice(0, idx).trimEnd() + (decoded ? `\n${decoded}` : '');
}

function describePsError(err, output) {
  if (err) {
    if (err.code === 'ENOENT') {
      return PS_BIN === 'pwsh'
        ? 'PowerShell (pwsh) is not installed on this server. Install it — see https://learn.microsoft.com/powershell/scripting/install/installing-powershell-on-linux'
        : 'powershell.exe was not found on this server.';
    }
    return `Failed to launch ${PS_BIN}: ${err.message}`;
  }
  if (/no supported WSMan client library/i.test(output)) {
    return 'pwsh on Linux needs the native WSMan library installed separately. Run once on this server: ' +
      'sudo pwsh -Command "Set-PSRepository -Name PSGallery -InstallationPolicy Trusted; Install-Module -Name PSWSMan -Scope AllUsers -Force; Install-WSMan"';
  }
  if (/gss|ntlm|negotiate/i.test(output) && /(auth|credential|denied|failed)/i.test(output)) {
    return 'If this host uses a local account (not a domain/Kerberos account), the Linux WSMan client needs the ' +
      'gss-ntlmssp package for NTLM support. Run once on this server: sudo apt install gssntlmssp';
  }
  const cliXml = decodeCliXml(output);
  if (cliXml) return cliXml;
  return null;
}

/**
 * WinRM install via PowerShell Invoke-Command running on the local server.
 * Optionally copies the installer file to the remote VM using Copy-Item -ToSession.
 *
 * @param {{ host, username, password, port?, filePath?, remoteDir?, command, timeout? }} opts
 * @returns Promise<{ connected, error, output, exitCode }>
 */
function winrmInstall({ host, username, password, port = 5985, filePath, remoteDir = 'C:/Windows/Temp', command, timeout = 300000 }) {
  return new Promise((resolve) => {
    const pw       = password.replace(/'/g, "''");
    const user     = username.replace(/'/g, "''");
    const safeHost = host.replace(/'/g, "''");

    let remoteFilePath = null;
    let scriptParts    = [];

    scriptParts.push(`$ErrorActionPreference = 'Stop'`);
    scriptParts.push(`$pw   = ConvertTo-SecureString '${pw}' -AsPlainText -Force`);
    scriptParts.push(`$cred = New-Object PSCredential('${user}', $pw)`);
    scriptParts.push(`$sopt = New-PSSessionOption -SkipCACheck -SkipCNCheck`);
    scriptParts.push(`$sess = New-PSSession -ComputerName '${safeHost}' -Port ${port} -Credential $cred -SessionOption $sopt`);

    if (filePath) {
      const filename      = path.basename(filePath);
      const safeLocalPath = filePath.replace(/'/g, "''");
      const safeRemoteDir = remoteDir.replace(/'/g, "''").replace(/\\/g, '/');
      remoteFilePath      = `${safeRemoteDir}/${filename}`;

      scriptParts.push(`Write-Output '[WinRM] Copying ${filename} to remote...'`);
      scriptParts.push(`Copy-Item -Path '${safeLocalPath}' -Destination '${remoteFilePath}' -ToSession $sess`);
      scriptParts.push(`Write-Output '[WinRM] Copy complete'`);
    }

    // Build the command, substituting {installer} if we copied a file
    let remoteCmd = command || '';
    if (remoteFilePath) {
      remoteCmd = remoteCmd.replace(/\{installer\}/g, remoteFilePath);
    }

    scriptParts.push(`Write-Output '[WinRM] Running command...'`);
    scriptParts.push(`Invoke-Command -Session $sess -ScriptBlock { ${remoteCmd} }`);
    scriptParts.push(`Remove-PSSession $sess`);

    const script  = scriptParts.join("\n");
    const encoded = Buffer.from(script, 'utf16le').toString('base64');

    let output = '';
    const timer = setTimeout(() => {
      resolve({ connected: false, error: `WinRM timed out after ${Math.round(timeout / 60000)} min`, output, exitCode: null });
    }, timeout + 5000);

    const child = execFile(
      PS_BIN,
      ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded],
      { timeout, maxBuffer: 10 * 1024 * 1024 },
    );

    child.stdout.on('data', d => { output += d; });
    child.stderr.on('data', d => { output += d; });

    child.on('close', (code) => {
      clearTimeout(timer);
      output = cleanPsOutput(output);
      const connected = !output.includes('WS-Management') && !output.includes('ETIMEDOUT')
        ? true
        : code !== null;
      const error = code !== 0 ? (describePsError(null, output) || `PowerShell exited with code ${code}`) : null;
      resolve({ connected, error, output, exitCode: code });
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ connected: false, error: describePsError(err, output), output, exitCode: null });
    });
  });
}

/**
 * Start or restart a Windows service over WinRM (PowerShell Remoting).
 * Windows targets rarely run an SSH server, so this reuses the same
 * transport as winrmInstall() rather than sshRunCommand/sshVerify (which
 * need SSH on the target and would just fail with ECONNREFUSED here).
 *
 * Returns the raw PowerShell output (including the final Get-Service status
 * line) rather than a parsed status — parse it with parseWindowsService()
 * from sshVerify.js so it stays consistent with how Live Check reports status.
 *
 * @param {{ host, username, password, port?, serviceName, action: 'start'|'restart', timeout? }} opts
 * @returns Promise<{ connected, error, output, exitCode }>
 */
function winrmServiceAction({ host, username, password, port = 5985, serviceName, action, timeout = 30000 }) {
  return new Promise((resolve) => {
    const pw       = password.replace(/'/g, "''");
    const user     = username.replace(/'/g, "''");
    const safeHost = host.replace(/'/g, "''");
    const safeSvc  = serviceName.replace(/'/g, "''");
    const verb     = action === 'restart' ? 'Restart-Service' : 'Start-Service';

    const script = [
      `$ErrorActionPreference = 'Stop'`,
      `$pw   = ConvertTo-SecureString '${pw}' -AsPlainText -Force`,
      `$cred = New-Object PSCredential('${user}', $pw)`,
      `$sopt = New-PSSessionOption -SkipCACheck -SkipCNCheck`,
      `$sess = New-PSSession -ComputerName '${safeHost}' -Port ${port} -Credential $cred -SessionOption $sopt`,
      `Write-Output '[WinRM] ${verb} -Name ${safeSvc}'`,
      `Invoke-Command -Session $sess -ScriptBlock {`,
      `  ${verb} -Name '${safeSvc}' -Force`,
      `  Start-Sleep -Seconds 1`,
      `  (Get-Service -Name '${safeSvc}').Status.ToString()`,
      `}`,
      `Remove-PSSession $sess`,
    ].join('\n');
    const encoded = Buffer.from(script, 'utf16le').toString('base64');

    let output = '';
    const timer = setTimeout(() => {
      resolve({ connected: false, error: `WinRM timed out after ${Math.round(timeout / 1000)}s`, output, exitCode: null });
    }, timeout + 5000);

    const child = execFile(
      PS_BIN,
      ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded],
      { timeout, maxBuffer: 10 * 1024 * 1024 },
    );

    child.stdout.on('data', d => { output += d; });
    child.stderr.on('data', d => { output += d; });

    child.on('close', (code) => {
      clearTimeout(timer);
      output = cleanPsOutput(output);
      const error = code !== 0 ? (describePsError(null, output) || `PowerShell exited with code ${code}`) : null;
      resolve({ connected: code !== null, error, output, exitCode: code });
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ connected: false, error: describePsError(err, output), output, exitCode: null });
    });
  });
}

/**
 * PsExec remote execution — runs psexec.exe locally to execute a command on the remote VM.
 * If filePath is provided, copies it to the remote VM with -c before running.
 *
 * @param {{ host, username, password, psexecPath, filePath?, command, timeout? }} opts
 * @returns Promise<{ connected, error, output, exitCode }>
 */
function psexecInstall({ host, username, password, psexecPath, filePath, command, timeout = 300000 }) {
  return new Promise((resolve) => {
    if (!fs.existsSync(psexecPath)) {
      return resolve({ connected: false, error: `PsExec not found: ${psecPath}`, output: '', exitCode: null });
    }

    const args = [
      `\\\\${host}`,
      '-u', username,
      '-p', password,
      '-accepteula',
      '-h',         // run with elevated token if possible
    ];

    if (filePath) {
      args.push('-c', filePath);      // copy file to remote ADMIN$ share before executing
      args.push('-f');                // force copy even if file already exists on remote
    }

    // Command to run on remote — split into argv
    const cmdArgs = (command || '').trim().split(/\s+/).filter(Boolean);
    if (!cmdArgs.length) {
      return resolve({ connected: false, error: 'No command configured for PsExec method', output: '', exitCode: null });
    }
    args.push(...cmdArgs);

    let output = `[PSEXEC] ${path.basename(psexecPath)} ${args.filter(a => a !== password).join(' ')}\n\n`;

    const timer = setTimeout(() => {
      resolve({ connected: true, error: `PsExec timed out after ${Math.round(timeout / 60000)} min`, output, exitCode: null });
    }, timeout + 5000);

    const child = execFile(psexecPath, args, { timeout, maxBuffer: 10 * 1024 * 1024 });

    child.stdout.on('data', d => { output += d; });
    child.stderr.on('data', d => { output += d; });  // psexec writes its own status to stderr

    child.on('close', (code) => {
      clearTimeout(timer);
      // PsExec exit 0 = success; non-zero = error on remote or connection issue
      const connected = code !== null && !output.includes('could not be accessed');
      resolve({ connected, error: null, output, exitCode: code });
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ connected: false, error: err.message, output, exitCode: null });
    });
  });
}

/**
 * WMI install — uses Win32_Process.Create via Invoke-WmiMethod (runs PowerShell locally).
 * File is copied via SMB/ADMIN$ share before execution if filePath is provided.
 * NOTE: WMI starts the process asynchronously; we cannot wait for its exit code.
 *
 * @param {{ host, username, password, filePath?, remoteDir?, command, smbPort?, timeout? }} opts
 * @returns Promise<{ connected, error, output, exitCode }>
 */
function wmiInstall({ host, username, password, filePath, remoteDir = 'C:/Windows/Temp', command, smbPort = 445, timeout = 120000 }) {
  return new Promise((resolve) => {
    const pw       = password.replace(/'/g, "''");
    const user     = username.replace(/'/g, "''");
    const safeHost = host.replace(/'/g, "''");

    const scriptParts = [
      `$ErrorActionPreference = 'Stop'`,
      `$pw   = ConvertTo-SecureString '${pw}' -AsPlainText -Force`,
      `$cred = New-Object PSCredential('${user}', $pw)`,
    ];

    let remoteCmd = command || '';

    if (filePath) {
      const filename     = path.basename(filePath);
      const remoteWin    = remoteDir.replace(/\//g, '\\').replace(/\\+$/, '') + '\\' + filename;
      const safeFP       = filePath.replace(/'/g, "''");
      const uncAdmin     = `\\\\${safeHost}\\ADMIN$`;
      const tempRelative = `Temp\\${filename}`;

      scriptParts.push(`Write-Output '[WMI] Connecting to ADMIN$ share...'`);
      scriptParts.push(`$drv = New-PSDrive -Name WmiDrive -PSProvider FileSystem -Root '${uncAdmin}' -Credential $cred`);
      scriptParts.push(`Copy-Item -Path '${safeFP}' -Destination "WmiDrive:\\${tempRelative}" -Force`);
      scriptParts.push(`Remove-PSDrive -Name WmiDrive`);
      scriptParts.push(`Write-Output '[WMI] File copied to ${remoteWin}'`);

      remoteCmd = remoteCmd.replace(/\{installer\}/g, remoteWin);
      if (!remoteCmd.trim()) remoteCmd = `${remoteWin} /Silent`;
    }

    const safeCmd = remoteCmd.replace(/'/g, "''");
    scriptParts.push(`Write-Output '[WMI] Invoking Win32_Process.Create: ${safeCmd}'`);
    scriptParts.push(`$r = Invoke-WmiMethod -ComputerName '${safeHost}' -Credential $cred -Namespace root\\cimv2 -Class Win32_Process -Name Create -ArgumentList '${safeCmd}'`);
    scriptParts.push(`$rv = $r.ReturnValue`);
    scriptParts.push(`if ($rv -ne 0) { throw "Win32_Process.Create returned $rv (0=success, 2=access, 3=insuff priv, 8=unknown, 9=invalid, 21=invalid param)" }`);
    scriptParts.push(`Write-Output "[WMI] Process started (PID=$($r.ProcessId)). NOTE: WMI is async — use Verify to confirm install completed."`);

    const script  = scriptParts.join("\n");
    const encoded = Buffer.from(script, 'utf16le').toString('base64');

    let output = '';
    const timer = setTimeout(() => {
      resolve({ connected: false, error: `WMI timed out after ${Math.round(timeout / 60000)} min`, output, exitCode: null });
    }, timeout + 5000);

    const child = execFile(
      PS_BIN,
      ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded],
      { timeout, maxBuffer: 10 * 1024 * 1024 },
    );

    child.stdout.on('data', d => { output += d; });
    child.stderr.on('data', d => { output += d; });

    child.on('close', (code) => {
      clearTimeout(timer);
      output = cleanPsOutput(output);
      resolve({
        connected: code !== null,
        error: code !== 0 ? describePsError(null, output) : null,   // other WMI errors surface in output via $ErrorActionPreference
        output,
        exitCode: code,
      });
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ connected: false, error: describePsError(err, output), output, exitCode: null });
    });
  });
}

module.exports = { winrmInstall, psexecInstall, wmiInstall, winrmServiceAction };
