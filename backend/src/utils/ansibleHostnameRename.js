const fs = require('fs');
const path = require('path');
const ansible = require('./ansibleRunner');

const PLAYBOOK_PATH = path.join(__dirname, '..', '..', 'ansible', 'rename_hostname.yml');

/**
 * Renames one host's OS-level hostname via Ansible (WinRM for Windows, SSH
 * for Linux/Proxmox) — see ansible/rename_hostname.yml. Modeled on
 * installWindowsViaAnsible (ansibleWindowsInstall.js), extended to also cover
 * the Linux play since this is the one place in the app that runs Ansible
 * against Linux targets rather than raw SSH (see that playbook's header
 * comment for why).
 *
 * @param {{ ip_address, username, password, isWindows, newHostname }} opts
 */
async function renameHostnameViaAnsible({ ip_address, username, password, isWindows, newHostname }) {
  const target = { ip_address, isWindows, username, password, vars: {} };

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
    const rebootRequired = /REBOOT_REQUIRED::\s*True/i.test(output);
    const error = succeeded ? null
      : !recap ? 'ansible-playbook did not run to completion — see the output.'
        : !connected ? `Could not reach the host over ${isWindows ? 'WinRM' : 'SSH'}.`
          : 'A playbook task failed — see the output.';

    return { connected, succeeded, exitCode, output, error, rebootRequired };
  } catch (e) {
    return {
      connected: false, succeeded: false, error: e.message, output: '',
      exitCode: null, rebootRequired: false,
    };
  } finally {
    if (inventoryPath) fs.promises.unlink(inventoryPath).catch(() => {});
  }
}

module.exports = { renameHostnameViaAnsible, PLAYBOOK_PATH };
