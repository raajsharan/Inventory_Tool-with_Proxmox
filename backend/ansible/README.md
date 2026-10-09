# Ansible setup

One-time setup on the backend host (must be Linux/macOS/WSL — Ansible's
control node cannot run natively on Windows):

```
pip install ansible-core
pip install -r requirements.txt
sudo ansible-galaxy collection install -r requirements.yml -p /usr/share/ansible/collections
```

The `-p` matters: without it the collections land in the *invoking* user's
`~/.ansible/collections` (i.e. `/root/...` when installed with sudo), which
the backend — running as `www-data` — can't read, and every play then fails
with `couldn't resolve module/action 'ansible.windows.win_shell'`.
`/usr/share/ansible/collections` is already on Ansible's default search path.

Also install `sshpass` via the OS package manager (not pip) — Ansible's
`ssh` connection plugin (used for Linux targets, e.g. `rename_hostname.yml`)
requires it whenever authenticating with a password instead of a key, which
is what every playbook here does (the asset record's stored password):

```
sudo apt-get install -y sshpass   # Debian/Ubuntu
sudo yum install -y sshpass       # RHEL/CentOS
sudo dnf install -y sshpass       # Fedora
```

Without it, Linux targets fail immediately with: `to use the 'ssh'
connection type with passwords ..., you must install the sshpass program`.

Then confirm `ansible-playbook` is on the `PATH` the Node backend process
runs with (`ansible-playbook --version`).

Prerequisites this doesn't and can't set up for you:

- **WinRM must already be enabled/configured on every Windows target.**
  Ansible has no other way to reach a Windows host.
- **The installer files `me_agent_windows.yml` / `nessus_agent_windows.yml`
  copy to each target must already exist on THIS backend server** (the
  Ansible control node), configured via the ME Install Config / Nessus
  Install Config admin pages. `win_copy` reads the file straight off local
  disk and pushes it to each target over the same WinRM connection already
  used for everything else, so there's no network share to set up and no
  `cifs-utils` dependency on the targets.
