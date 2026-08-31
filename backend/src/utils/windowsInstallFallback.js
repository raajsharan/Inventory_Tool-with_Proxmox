const fs = require('fs');
const { winrmInstall, psexecInstall, wmiInstall } = require('./winInstall');
const { sshRunCommand, sshUploadAndRun } = require('./sshVerify');

// Shared by Nessus Agent install (nessusStatusController.js) and ManageEngine
// Agent install (softwareStatusController.js) — both push an agent installer
// onto a Windows Server host over whichever of these transports is reachable.
// Auto mode tries each in turn and stops at the first that both connects and
// exits 0; a specific method skips straight to that one attempt.
const AUTO_ORDER = ['winrm', 'wmi', 'psexec', 'ssh', 'ssh_bash'];

// Dispatches one Windows install attempt to the matching transport.
async function runWindowsMethod({ method, host, port, username, password, cfgRow, remoteDir, timeout = 300000 }) {
  const filePath = cfgRow.windows_file_path;
  const cmd      = cfgRow.windows_cmd || '';

  if (method === 'winrm') {
    return winrmInstall({
      host, username, password,
      port: cfgRow.windows_winrm_port || 5985,
      filePath: filePath || null,
      remoteDir,
      command: cmd || (filePath ? `& '{installer}' /Silent` : ''),
      timeout,
    });
  }

  if (method === 'wmi') {
    return wmiInstall({
      host, username, password,
      filePath: filePath || null,
      remoteDir,
      smbPort: cfgRow.windows_smb_port || 445,
      command: cmd || (filePath ? '{installer} /Silent' : ''),
      timeout,
    });
  }

  if (method === 'psexec') {
    const psexecPath = cfgRow.windows_psexec_path;
    if (!psexecPath || !fs.existsSync(psexecPath)) {
      return { connected: false, error: `PsExec not found: ${psexecPath || '(not configured)'}`, output: '', exitCode: null };
    }
    return psexecInstall({ host, username, password, psexecPath, filePath, command: cmd, timeout });
  }

  // ssh / ssh_bash
  let execCmd = cmd || (filePath ? '{installer} /Silent' : '');
  if (method === 'ssh_bash') {
    execCmd = `bash -c '${execCmd.replace(/'/g, "'\\''")}'`;
  }
  if (filePath) {
    return sshUploadAndRun({
      host, port, username, password, remoteDir,
      files: [{ localPath: filePath, placeholder: 'installer' }],
      command: execCmd, timeout,
    });
  }
  return sshRunCommand({ host, port, username, password, command: execCmd, timeout });
}

/**
 * Runs the Windows install, trying either one method or the full AUTO_ORDER
 * fallback chain, logging each attempt, and returning the exact response
 * shape both Nessus Status and Software Status hand back to their frontends:
 * { ...lastResult, platform: 'windows', os_type, command, method, tried, succeeded_method }
 *
 * @param {{ ip_address, port, username, password, cfgRow, remoteDir, osType,
 *   windows_method_override?, appendLog: Function, logFile: string|null, agentLabel: string }} opts
 */
async function installWindowsWithFallback({
  ip_address, port, username, password, cfgRow, remoteDir, osType,
  windows_method_override, appendLog, logFile, agentLabel,
}) {
  const selectedMethod = windows_method_override || cfgRow.windows_method || 'auto';
  const methodsToTry   = selectedMethod === 'auto' ? AUTO_ORDER : [selectedMethod];
  const tried = [];
  let lastResult = null;

  for (const method of methodsToTry) {
    const timeout = selectedMethod === 'auto' ? 45000 : 300000;
    if (selectedMethod === 'auto') {
      const portHint = method === 'winrm' ? ` on port ${cfgRow.windows_winrm_port || 5985}` : '';
      appendLog(logFile, ip_address, 'INFO', `Auto mode trying ${method.toUpperCase()}${portHint}`);
    }
    let r;
    try {
      r = await runWindowsMethod({ method, host: ip_address, port, username, password, cfgRow, remoteDir, timeout });
    } catch (e) {
      r = { connected: false, error: e.message, output: '', exitCode: null };
    }
    tried.push({ method, connected: r.connected, exitCode: r.exitCode, error: r.error || null });
    lastResult = r;

    if (r.connected && r.exitCode === 0) {
      if (selectedMethod === 'auto') {
        appendLog(logFile, ip_address, 'INFO',    `Auto mode selected ${method.toUpperCase()}`);
        appendLog(logFile, ip_address, 'SUCCESS', 'Connection test passed');
        appendLog(logFile, ip_address, 'INFO',    `${agentLabel} deployment completed via ${method.toUpperCase()}`);
      } else {
        appendLog(logFile, ip_address, 'SUCCESS', `${agentLabel} deployment completed via ${method.toUpperCase()}`);
      }
      return {
        ...r, platform: 'windows', os_type: osType, command: cfgRow.windows_cmd || '',
        method, tried: tried.length > 1 ? tried : undefined,
        succeeded_method: selectedMethod === 'auto' ? method : undefined,
      };
    }
    if (r.error) appendLog(logFile, ip_address, 'ERROR', `${method.toUpperCase()} failed: ${r.error}`);
    if (selectedMethod !== 'auto') break;
  }

  appendLog(logFile, ip_address, 'ERROR', `All methods exhausted. ${agentLabel} deployment failed.`);
  return {
    ...lastResult, platform: 'windows', os_type: osType, command: cfgRow.windows_cmd || '',
    method: methodsToTry[methodsToTry.length - 1],
    tried: tried.length > 1 ? tried : undefined,
  };
}

module.exports = { AUTO_ORDER, runWindowsMethod, installWindowsWithFallback };
