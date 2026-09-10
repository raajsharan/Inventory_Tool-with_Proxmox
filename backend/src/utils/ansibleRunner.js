const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const PLAYBOOK_PATH = path.join(__dirname, '..', '..', 'ansible', 'me_agent_deploy.yml');

// Ansible inventory content, written as JSON — valid YAML, so a .yml
// extension parses cleanly via the yaml inventory plugin without any of
// the INI format's quoting/escaping pitfalls (host vars here include
// decrypted passwords straight from JSON.stringify's own escaping).
function buildInventory(targets) {
  const groups = { windows: { hosts: {} }, linux: { hosts: {} } };
  for (const t of targets) {
    const group = t.isWindows ? 'windows' : 'linux';
    groups[group].hosts[t.ip_address] = {
      ansible_user: t.username,
      ansible_password: t.password,
      ansible_connection: t.isWindows ? 'winrm' : 'ssh',
      ...(t.isWindows
        ? {
          ansible_port: 5985,
          ansible_winrm_transport: 'ntlm',
          ansible_winrm_server_cert_validation: 'ignore',
        }
        : {
          ansible_ssh_common_args: '-o StrictHostKeyChecking=no',
          ansible_become_password: t.password,
        }),
      share_path: t.sharePath || '',
      installer_file: t.installerFile || '',
      install_cmd: t.installCmd || '',
    };
  }
  return JSON.stringify(groups, null, 2);
}

async function writeTempInventory(targets) {
  const filePath = path.join(os.tmpdir(), `test-deploy-inv-${crypto.randomUUID()}.yml`);
  await fs.promises.writeFile(filePath, buildInventory(targets), { mode: 0o600 });
  return filePath;
}

// Runs `ansible-playbook -i <inventory> me_agent_deploy.yml`, resolving once
// the process exits with the full captured stdout+stderr (interleaved, in
// arrival order) — one combined run log rather than per-host streams.
function runPlaybook(inventoryPath) {
  return new Promise((resolve) => {
    const child = spawn('ansible-playbook', ['-i', inventoryPath, PLAYBOOK_PATH], {
      env: { ...process.env, ANSIBLE_HOST_KEY_CHECKING: 'False' },
    });
    let output = '';
    child.stdout.on('data', (d) => { output += d.toString(); });
    child.stderr.on('data', (d) => { output += d.toString(); });
    child.on('error', (e) => resolve({ exitCode: null, output: output + `\n[ansible-playbook failed to start: ${e.message}]` }));
    child.on('close', (code) => resolve({ exitCode: code, output }));
  });
}

module.exports = { buildInventory, writeTempInventory, runPlaybook, PLAYBOOK_PATH };
