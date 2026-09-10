# Test Deploy — Ansible setup

One-time setup on the backend host (must be Linux/macOS/WSL — Ansible's
control node cannot run natively on Windows):

```
pip install ansible-core
pip install -r requirements.txt
ansible-galaxy collection install -r requirements.yml
```

Then confirm `ansible-playbook` is on the `PATH` the Node backend process
runs with (`ansible-playbook --version`).

Prerequisites this doesn't and can't set up for you:

- **WinRM must already be enabled/configured on every Windows target.**
  Ansible has no other way to reach a Windows host.
- Fill in the real silent-install command for the ME Agent installer in
  the Test Deploy Config admin page (Windows/Linux, default + per-location)
  — `me_agent_deploy.yml` ships with a placeholder switch until then.
- If Copy-Item from the network share fails with Access Denied on Windows
  targets even with correct credentials, see the "double hop" note at the
  top of `me_agent_deploy.yml`.
