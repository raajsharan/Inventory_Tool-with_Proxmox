const fs = require('fs');
const path = require('path');
const ansible = require('./ansibleRunner');

const PLAYBOOK_PATH = path.join(__dirname, '..', '..', 'ansible', 'rename_hostname.yml');

/**
 * Renames one host's OS-level hostname via Ansible (SSH for both Windows —
 * OpenSSH + PowerShell — and Linux/Proxmox) — see ansible/rename_hostname.yml. Modeled on
 * installWindowsViaAnsible (ansibleWindowsInstall.js), extended to also cover
 * the Linux play since this is the one place in the app that runs Ansible
 * against Linux targets rather than raw SSH (see that playbook's header
 * comment for why).
 *
 * Windows targets are rebooted automatically by the playbook once renamed —
 * this call doesn't resolve until that reboot completes and the host is back,
 * so it can take several minutes for Windows.
 *
 * @param {{ ip_address, username, password, isWindows, newHostname }} opts
 */
async function renameHostnameViaAnsible({ ip_address, username, password, isWindows, newHostname }) {
  // Windows is renamed over SSH (OpenSSH + PowerShell) rather than WinRM —
  // 5985 is often blocked or not enabled on freshly built servers.
  const target = { ip_address, isWindows, username, password, vars: {}, windowsTransport: 'ssh' };

  let inventoryPath;
  try {
    inventoryPath = await ansible.writeTempInventory([target], {
      build: ansible.buildVarsInventory, prefix: 'ansible-rename-inv',
    });
    const { exitCode, output } = await ansible.runPlaybook(
      inventoryPath, { new_hostname: newHostname }, PLAYBOOK_PATH
    );

    const recap = output.match(/^\S+\s*:\s*ok=\d+\s+changed=\d+\s+unreachable=(\d+)\s+failed=(\d+)/m);
    const connected = !!recap && recap[1] === '0';
    const succeeded = connected && exitCode === 0;
    // Windows only — the playbook reboots automatically once renamed, so this
    // reflects whether that reboot actually happened (false for a no-op
    // rename, and always false for Linux, which never reboots).
    const rebooted = /REBOOTED::\s*True/i.test(output);
    const error = succeeded ? null
      : !recap ? 'ansible-playbook did not run to completion — see the output.'
        : !connected ? 'Could not reach the host over SSH.'
          : 'A playbook task failed — see the output.';

    return { connected, succeeded, exitCode, output, error, rebooted };
  } catch (e) {
    return {
      connected: false, succeeded: false, error: e.message, output: '',
      exitCode: null, rebooted: false,
    };
  } finally {
    if (inventoryPath) fs.promises.unlink(inventoryPath).catch(() => {});
  }
}

module.exports = { renameHostnameViaAnsible, PLAYBOOK_PATH };
