import { Typography } from 'antd';

// hostname-rename's `source` is the literal DB table name (assets,
// beijing_assets, ...) — the Software Status / Nessus Status install
// endpoints use their own human-readable labels instead, so callers here
// keep passing the same table-name `source` used everywhere else and this
// translates it once.
const SOURCE_LABEL = {
  assets: 'MSL Assets',
  beijing_assets: 'Beijing Assets',
  ext_assets: 'Ext. Assets',
  physical_esxi_servers: 'Physical Servers',
};

function isOk(data) {
  if (!data) return false;
  if (data.skipped) return true; // already installed, or correctly not attempted — not a failure
  return !!(data.connected && data.exitCode === 0);
}

function outcomeLine(label, data) {
  if (!data) return `${label}: not attempted.`;
  if (data.needs_credentials) return `${label}: skipped — no saved username/password to connect with.`;
  if (data.skipped) return `${label}: skipped — ${data.reason || 'already installed'}.`;
  if (data.connected && data.exitCode === 0) return `${label}: installed successfully.`;
  return `${label}: failed — ${data.error || 'see Software Status / Nessus Status for details'}.`;
}

async function runJob(api, base, source, ipAddress) {
  try {
    const { data: started } = await api.post(`${base}/install-async`, { ip_address: ipAddress, source, port: 22 });
    const deadline = Date.now() + 20 * 60 * 1000;
    for (;;) {
      await new Promise((res) => setTimeout(res, 3000));
      if (Date.now() > deadline) return { error: 'Timed out waiting for the install — check the install log.' };
      const { data: s } = await api.get(`${base}/install-status/${started.job_id}`);
      if (s.state === 'done') return s.result;
    }
  } catch (e) {
    return { error: e.response?.data?.error || e.message || 'Request failed' };
  }
}

// Calls the existing ME Agent / Nessus Agent install endpoints — the same
// ones Software Status's and Nessus Status's own per-host "Install" button
// call — for a just-saved asset, so a brand-new host can get both agents
// deployed in the same step instead of a separate visit to those pages
// afterward. Mirrors runHostnameRename's "await between save and navigate
// away" shape, and the same never-throws contract: a failed install is
// reported via the modal, not a rejected promise, since the inventory
// record itself was already saved by the time this runs. Uses whichever
// Windows install method (Ansible/WinRM/WMI/PsExec/SSH) is already
// configured on Software Status / Nessus Status — ansible is the default
// there, this doesn't force it.
export async function runAgentInstalls({ api, modal, message, source, ipAddress, installMe, installNessus, quiet = false }) {
  if (!installMe && !installNessus) return;
  const sourceLabel = SOURCE_LABEL[source];
  message.loading({ content: 'Installing ManageEngine / Nessus agents…', key: 'agent-install', duration: 0 });
  try {
    // One at a time: two installers on the same Windows host can collide on
    // the Windows Installer mutex. Each runs as a background job and is polled,
    // since a single long request gets cut off (504) by gateways.
    const meResult     = installMe     ? await runJob(api, '/software-status', sourceLabel, ipAddress) : null;
    const nessusResult = installNessus ? await runJob(api, '/nessus-status',   sourceLabel, ipAddress) : null;
    message.destroy('agent-install');

    const items = [];
    if (installMe) items.push({ label: 'ManageEngine Agent', data: meResult });
    if (installNessus) items.push({ label: 'Nessus Agent', data: nessusResult });
    const allOk = items.every((it) => isOk(it.data));
    // quiet (edit-saves): stay silent when nothing was actually attempted —
    // no saved credentials, or already installed — and only surface real failures.
    if (quiet && items.every((it) => it.data?.needs_credentials || isOk(it.data))) return;

    (allOk ? modal.success : modal.warning)({
      title: 'Agent install',
      width: 560,
      content: (
        <div>
          {items.map((it) => (
            <Typography.Paragraph key={it.label} style={{ marginBottom: 6 }}>
              {outcomeLine(it.label, it.data)}
            </Typography.Paragraph>
          ))}
          <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
            The inventory record was saved regardless — retry or check details from Software Status / Nessus Status.
          </Typography.Paragraph>
        </div>
      ),
    });
  } catch (e) {
    message.destroy('agent-install');
    modal.error({
      title: 'Agent install failed',
      content: e.response?.data?.error || 'Request failed — the inventory record was still saved.',
    });
  }
}
