# Test Deploy — Ansible setup

One-time setup on the backend host (must be Linux/macOS/WSL — Ansible's
control node cannot run natively on Windows):

```
pip install ansible-core
pip install -r requirements.txt
ansible-galaxy collection install -r requirements.yml
```

Also install `sshpass` via the OS package manager (not pip) — Ansible's
`ssh` connection plugin (used for Linux targets) requires it whenever
authenticating with a password instead of a key, which is what Test
Deploy always does (the asset record's stored password):

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
- Fill in the real silent-install command for the ME Agent installer in
  the Test Deploy Config admin page (Windows/Linux, default + per-location)
  — `me_agent_deploy.yml` ships with a placeholder switch until then.
- Windows share paths should point at the source server's **admin share**
  (e.g. `\\fileserver\C$\me-agents\windows`). The target re-authenticates
  to it with its own asset-record credentials before copying (see
  `me_agent_deploy.yml`) — this is the double-hop workaround, and it means
  that account needs admin rights on the source file server too, not just
  on the target itself.
