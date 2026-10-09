// Builds/validates the suggested server hostname shown on the Assets /
// Beijing Assets / Ext. Assets / Physical & ESXi Servers forms' "Suggested
// Hostname" panel: SiteCode(3) + OS(1) + Team(3) + Tier(1) + AssetTag(4),
// e.g. BJSLDEVP0001. Mirrored in backend/src/utils/hostnamePattern.js — keep
// both in sync by hand; there's no shared-code path between the two stacks
// in this app.
//
// Site/Team/Tier are closed, policy-defined code lists (unlike
// location/department, which genuinely grow over time and so live in the
// admin-editable dropdown_master instead) — adding a new office or team means
// editing this file (and its backend mirror), not an admin screen.
export const SITE_CODES = {
  Beijing: 'BJS',
  Toronto: 'TOR',
  Burlington: 'BUR',
  'Boston Bomgar': 'BOS',
};

export const TEAM_OPTIONS = [
  { code: 'ITO', label: 'IT Team' },
  { code: 'LAB', label: 'Lab Team' },
  { code: 'QAT', label: 'QA Team' },
  { code: 'DEV', label: 'Development Team' },
  { code: 'DVO', label: 'Dev-Ops Team' },
  { code: 'SNP', label: 'Support and Service Team' },
  { code: 'PLT', label: 'Platform Team' },
  { code: 'SEC', label: 'Application Security Team' },
  { code: 'PSE', label: 'Pre-Sales Engineer Team' },
  { code: 'NEA', label: 'Network Engineering Automation Team' },
];

export const TIER_OPTIONS = [
  { code: 'P', label: 'Production' },
  { code: 'S', label: 'Staging' },
  { code: 'D', label: 'Development' },
  { code: 'T', label: 'Testing' },
  { code: 'C', label: 'Customer-facing' },
  { code: 'G', label: 'General Purpose' },
];

// This app's os_type values are coarse platform buckets (Linux / Windows /
// VMware / Proxmox), not free-text OS descriptions. Proxmox is Debian/Linux
// underneath, so it gets 'L'. VMware (ESXi) gets 'E' for the suggested text,
// but there's no Ansible module for ESXi in this codebase yet, so the live
// rename action doesn't support it (see HostnameSuggestionPanel.jsx) even
// though the suggested hostname text still uses the right letter.
const OS_LETTER = { Linux: 'L', Windows: 'W', VMware: 'E', Proxmox: 'L' };

export function osLetter(osType) {
  return OS_LETTER[osType] || null;
}

// Best-effort guess at a department's Team code, purely to pre-fill the
// (still user-editable) Team select — asset managers confirm or correct it,
// nothing here is authoritative. Matched by keyword rather than exact name
// since departments are admin-defined free text, not a fixed enum.
export function guessTeamFromDepartment(departmentName) {
  const d = (departmentName || '').toLowerCase();
  if (d.includes('lab')) return 'LAB';
  if (d.includes('qa')) return 'QAT';
  if (d.includes('devops') || d.includes('dev-ops') || d.includes('dev ops')) return 'DVO';
  if (d.includes('dev')) return 'DEV';
  if (d.includes('support') || d.includes('service')) return 'SNP';
  if (d.includes('platform')) return 'PLT';
  if (d.includes('security')) return 'SEC';
  if (d.includes('pre-sales') || d.includes('presales') || d.includes('sales')) return 'PSE';
  if (d.includes('network')) return 'NEA';
  if (d.includes('it')) return 'ITO';
  return null;
}

// Returns the composed hostname string, or null if any input is missing —
// callers treat null as "can't suggest one yet".
export function buildHostname({ location, osType, team, tier, assetTag }) {
  const site = SITE_CODES[location];
  const os = osLetter(osType);
  const digits = String(assetTag || '').replace(/\D/g, '');
  if (!site || !os || !team || !tier || digits.length === 0) return null;
  const tag = digits.padStart(4, '0').slice(-4);
  return `${site}${os}${team}${tier}${tag}`;
}
