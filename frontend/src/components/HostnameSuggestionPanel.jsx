import { useEffect, useState } from 'react';
import { Select, Checkbox, Typography, Space, Alert, Divider } from 'antd';
import { guessTeamFromDepartment, buildHostname } from '../constants/hostnamePattern.js';

// Chrome/Edge forces its own background+text color on an input it thinks is
// fillable (via the :-webkit-autofill pseudo-class), which cannot be
// overridden with a plain background-color rule — only this inset
// box-shadow trick actually beats it. Without this, the Team/Tier selects
// (and any plain input here) render with the browser's autofill tint
// instead of the app's own colors, most visibly in dark mode. Scoped to
// this panel via .hn-panel rather than applied globally, since that's the
// only place this was reported.
const AUTOFILL_FIX_CSS = `
.hn-panel input:-webkit-autofill,
.hn-panel input:-webkit-autofill:hover,
.hn-panel input:-webkit-autofill:focus,
.hn-panel input:-webkit-autofill:active {
  -webkit-text-fill-color: var(--hn-fg) !important;
  box-shadow: 0 0 0 1000px var(--hn-bg) inset !important;
  transition: background-color 5000s ease-in-out 0s;
}
`;

// Lets the asset manager confirm/adjust a hostname suggested from the
// server naming pattern (Site + OS + Team + Tier + Asset Tag) and, if they
// check "Assign this hostname", have the parent form both save it to
// os_hostname and (for Linux/Windows, via Ansible) rename the live server to
// match. Team/Tier/assign state is owned by the parent (AssetForm /
// PhysicalEsxiForm) so onFinish there can read it directly — this component
// is purely presentational plus the Team auto-guess effect.
export default function HostnameSuggestionPanel({
  location, osType, department, assetTag, currentHostname,
  team, setTeam, tier, setTier, assign, setAssign,
  siteCodes = {}, teamCodes = [], tierCodes = [], segmentOrder,
  canInstallAgents, installAgents, setInstallAgents,
}) {
  // Re-guess the Team suggestion whenever Department changes, but only while
  // the admin hasn't picked one themselves yet — so toggling Department back
  // and forth never clobbers a manual choice.
  const [teamTouched, setTeamTouched] = useState(false);
  useEffect(() => {
    if (teamTouched) return;
    const guess = guessTeamFromDepartment(department, teamCodes);
    if (guess) setTeam(guess);
  }, [department, teamCodes]); // eslint-disable-line react-hooks/exhaustive-deps

  const hostname = buildHostname({ location, osType, team, tier, assetTag, siteCodes, segmentOrder });
  const missing = [];
  if (!location) missing.push('Location');
  if (!osType) missing.push('OS Type');
  if (!team) missing.push('Team');
  if (!tier) missing.push('Tier');
  if (!assetTag) missing.push('Department (for the asset tag)');

  return (
    <div className="hn-panel" style={{
      padding: 16, borderRadius: 8, border: '1px solid var(--ant-color-border-secondary, #f0f0f0)',
      marginBottom: 16, background: 'var(--ant-color-fill-alter, #fafafa)',
      '--hn-bg': 'var(--ant-color-bg-container, #ffffff)',
      '--hn-fg': 'var(--ant-color-text, rgba(0,0,0,0.88))',
    }}>
      <style>{AUTOFILL_FIX_CSS}</style>
      <Typography.Text strong style={{ display: 'block', marginBottom: 10 }}>
        Suggested Hostname
      </Typography.Text>

      {currentHostname && (
        <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 10 }}>
          Currently saved: <Typography.Text code>{currentHostname}</Typography.Text>
        </Typography.Text>
      )}

      <Space wrap style={{ marginBottom: 10 }}>
        <Select
          style={{ width: 260 }}
          placeholder="Team"
          value={team || undefined}
          onChange={(v) => { setTeamTouched(true); setTeam(v); }}
          options={teamCodes.map(t => ({ value: t.code, label: `${t.code} — ${t.label}` }))}
        />
        <Select
          style={{ width: 220 }}
          placeholder="Tier"
          value={tier || undefined}
          onChange={setTier}
          options={tierCodes.map(t => ({ value: t.code, label: `${t.code} — ${t.label}` }))}
        />
      </Space>

      {hostname ? (
        <Typography.Paragraph style={{ marginBottom: 10 }}>
          Suggested hostname: <Typography.Text code strong copyable>{hostname}</Typography.Text>
        </Typography.Paragraph>
      ) : (
        <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 10 }}>
          Fill in {missing.join(', ')} to compute a suggested hostname.
        </Typography.Text>
      )}

      <Checkbox checked={assign} disabled={!hostname} onChange={(e) => setAssign(e.target.checked)}>
        Assign this hostname — on Save, the OS Hostname field is set to the value above
        {osType === 'Windows'
          ? ' and the server itself is renamed live via Ansible, using its saved username & password — it will also reboot automatically to finish applying the new name.'
          : osType === 'Linux' || osType === 'Proxmox'
            ? ' and the server itself is renamed live via Ansible, using its saved username & password.'
            : '.'}
      </Checkbox>

      {assign && osType === 'Windows' && (
        <Alert style={{ marginTop: 10 }} type="warning" showIcon
          message="This will reboot the server automatically, disconnecting anyone currently using it." />
      )}

      {assign && osType === 'VMware' && (
        <Alert style={{ marginTop: 10 }} type="warning" showIcon
          message="Live rename isn't supported for VMware/ESXi hosts yet — only the OS Hostname field will be updated. Rename the host's hostname manually (esxcli system hostname set)." />
      )}

      {canInstallAgents && (osType === 'Windows' || osType === 'Linux') && (
        <>
          <Divider style={{ margin: '12px 0' }} />
          <Checkbox checked={installAgents} onChange={(e) => setInstallAgents(e.target.checked)}>
            Also install the ManageEngine Agent and Nessus Agent on Save, via Ansible — using the
            install configuration already set up under Software Status / Nessus Status.
          </Checkbox>
        </>
      )}
    </div>
  );
}
