const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const PLAYBOOK_PATH = path.join(__dirname, '..', '..', 'ansible', 'me_agent_deploy.yml');

// ansible-playbook puts its working temp dir under $HOME/.ansible/tmp. The
// backend runs as www-data, whose home (/var/www) it can't write to, so every
// run died before the first task with "Unable to create local
// directories(/var/www/.ansible/tmp): [Errno 13] Permission denied". Pointing
// it at the service's own tmp fixes that without granting www-data write
// access to its home — and under systemd's PrivateTmp=true this is a private,
// self-cleaning tmpfs rather than the shared /tmp.
const LOCAL_TMP = path.join(os.tmpdir(), 'ansible-tmp');

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
      serverinfo_file: t.serverinfoFile || '',
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
// extraVars.check_only=true skips the install task (see me_agent_deploy.yml)
// so a verify-only run just proves the file transfer step works.
function runPlaybook(inventoryPath, extraVars = {}) {
  return new Promise((resolve) => {
    const args = ['-i', inventoryPath, PLAYBOOK_PATH];
    if (Object.keys(extraVars).length) args.push('--extra-vars', JSON.stringify(extraVars));
    fs.mkdirSync(LOCAL_TMP, { recursive: true });
    const child = spawn('ansible-playbook', args, {
      env: {
        ...process.env,
        ANSIBLE_HOST_KEY_CHECKING: 'False',
        ANSIBLE_LOCAL_TEMP: LOCAL_TMP,
      },
    });
    let output = '';
    child.stdout.on('data', (d) => { output += d.toString(); });
    child.stderr.on('data', (d) => { output += d.toString(); });
    child.on('error', (e) => resolve({ exitCode: null, output: output + `\n[ansible-playbook failed to start: ${e.message}]` }));
    child.on('close', (code) => resolve({ exitCode: code, output }));
  });
}

module.exports = { buildInventory, writeTempInventory, runPlaybook, PLAYBOOK_PATH };
