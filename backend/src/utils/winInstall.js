const { execFile } = require('child_process');
const path = require('path');
const fs   = require('fs');

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
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded],
      { timeout, maxBuffer: 10 * 1024 * 1024 },
    );

    child.stdout.on('data', d => { output += d; });
    child.stderr.on('data', d => { output += d; });

    child.on('close', (code) => {
      clearTimeout(timer);
      const connected = !output.includes('WS-Management') && !output.includes('ETIMEDOUT')
        ? true
        : code !== null;
      resolve({ connected, error: code !== 0 ? `PowerShell exited with code ${code}` : null, output, exitCode: code });
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ connected: false, error: err.message, output, exitCode: null });
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
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded],
      { timeout, maxBuffer: 10 * 1024 * 1024 },
    );

    child.stdout.on('data', d => { output += d; });
    child.stderr.on('data', d => { output += d; });

    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({
        connected: code !== null,
        error: code !== 0 ? null : null,   // WMI errors surface in output via $ErrorActionPreference
        output,
        exitCode: code,
      });
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ connected: false, error: err.message, output, exitCode: null });
    });
  });
}

module.exports = { winrmInstall, psexecInstall, wmiInstall };
