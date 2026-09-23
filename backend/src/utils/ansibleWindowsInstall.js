const fs = require('fs');
const ansible = require('./ansibleRunner');

/**
 * Runs a Windows agent-install playbook against a single host and returns the
 * same response shape installWindowsWithFallback() does, so the two are
 * interchangeable from a controller's point of view.
 *
 * Shared by Nessus Agent Status and Software Status (ManageEngine) — the two
 * pages differ only in which playbook runs and what host vars it gets, the
 * same way windowsInstallFallback.js is shared between them for the
 * WinRM/WMI/PsExec/SSH transports.
 *
 * `vars` land in the inventory as host vars, so anything secret in them (the
 * Tenable linking key, for one) is written to a 0600 temp file that is deleted
 * when the run ends, and the playbook is responsible for keeping it out of the
 * run log via no_log.
 *
 * @param {{ ip_address, username, password, osType, playbookPath, playbookName,
 *   vars: object, command: string, appendLog: Function, logFile: string|null,
 *   agentLabel: string }} opts
 */
async function installWindowsViaAnsible({
  ip_address, username, password, osType,
  playbookPath, playbookName, vars, command,
  appendLog, logFile, agentLabel,
}) {
  const target = { ip_address, isWindows: true, username, password, vars };

  let inventoryPath;
  try {
    inventoryPath = await ansible.writeTempInventory([target], {
      build: ansible.buildVarsInventory, prefix: 'ansible-win-inv',
    });
    appendLog(logFile, ip_address, 'INFO', `Ansible: running ${playbookName}`);
    const { exitCode, output } = await ansible.runPlaybook(inventoryPath, {}, playbookPath);

    const recap = output.match(/^\S+\s*:\s*ok=\d+\s+changed=\d+\s+unreachable=(\d+)\s+failed=(\d+)/m);
    const connected = !!recap && recap[1] === '0';
    const succeeded = connected && exitCode === 0;
    const error = succeeded ? null
      : !recap ? 'ansible-playbook did not run to completion — see the output.'
        : !connected ? 'Could not reach the host over WinRM.'
          : 'A playbook task failed — see the output.';

    appendLog(logFile, ip_address, succeeded ? 'SUCCESS' : 'ERROR',
      succeeded ? `${agentLabel} deployment completed via ANSIBLE` : `ANSIBLE failed: ${error}`);

    return {
      connected, exitCode, output, error, command,
      platform: 'windows', os_type: osType, method: 'ansible',
    };
  } catch (e) {
    appendLog(logFile, ip_address, 'ERROR', `ANSIBLE failed: ${e.message}`);
    return {
      connected: false, error: e.message, output: '', exitCode: null, command,
      platform: 'windows', os_type: osType, method: 'ansible',
    };
  } finally {
    if (inventoryPath) fs.promises.unlink(inventoryPath).catch(() => {});
  }
}

module.exports = { installWindowsViaAnsible };
