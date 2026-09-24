const fs = require('fs');
const ansible = require('./ansibleRunner');

// win_service_info reports Ansible's own state vocabulary; the rest of the app
// (parseWindowsService, the status chips in both status pages) uses these.
const STATE_MAP = {
  started: 'running',
  running: 'running',
  stopped: 'stopped',
  paused: 'paused',
  starting: 'activating',
  start_pending: 'activating',
  stopping: 'stopping',
  stop_pending: 'stopping',
  not_found: 'not_found',
};

/**
 * Checks a Windows agent's service + binary over Ansible (pywinrm), returning
 * the same shape winrmVerify() does so the two are interchangeable:
 *   { connected, error, service: {status, output, name}, file: {exists, path},
 *     installed, platform: 'windows' }
 *
 * Shared by Nessus Agent Status and Software Status, which differ only in
 * which service name and binary path they look for.
 *
 * @param {{ ip_address, username, password, serviceName, binaryPath }} opts
 */
async function verifyWindowsAgentViaAnsible({ ip_address, username, password, serviceName, binaryPath }) {
  const miss = (error) => ({
    connected: false, error, service: null, file: null, platform: 'windows',
  });

  let inventoryPath;
  try {
    inventoryPath = await ansible.writeTempInventory([{
      ip_address, isWindows: true, username, password,
      vars: { agent_service_name: serviceName, agent_binary_path: binaryPath },
    }], { build: ansible.buildVarsInventory, prefix: 'agent-verify-inv' });

    const { output } = await ansible.runPlaybook(inventoryPath, {}, ansible.VERIFY_WINDOWS_PLAYBOOK);

    const recap = output.match(/^\S+\s*:\s*ok=\d+\s+changed=\d+\s+unreachable=(\d+)\s+failed=(\d+)/m);
    if (!recap) return miss('ansible-playbook did not run to completion — see the server log.');
    if (recap[1] !== '0') return miss('Could not reach the host over WinRM.');

    // Ansible's default callback prints the debug msg with its own quoting, so
    // match the marker rather than trying to parse the surrounding JSON.
    const m = output.match(/AGENTCHECK::(\S+?)::(\w+)/);
    if (!m) return miss('The verification task did not report a result — see the server log.');

    const status = STATE_MAP[m[1].toLowerCase()] || 'unknown';
    const exists = /^true$/i.test(m[2]);

    return {
      connected: true,
      error: null,
      service: { status, output: m[1], name: serviceName },
      file: { exists, path: binaryPath },
      installed: status === 'running' || exists,
      platform: 'windows',
    };
  } catch (e) {
    return miss(e.message);
  } finally {
    if (inventoryPath) fs.promises.unlink(inventoryPath).catch(() => {});
  }
}

module.exports = { verifyWindowsAgentViaAnsible };
