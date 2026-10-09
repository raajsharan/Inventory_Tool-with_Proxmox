// Builds/validates the suggested server hostname shown on the Assets /
// Beijing Assets / Ext. Assets / Physical & ESXi Servers forms' "Suggested
// Hostname" panel: SiteCode(3) + OS(1) + Team(3) + Tier(1) + AssetTag(4),
// e.g. BJSLDEVP0001. Mirrored in frontend/src/constants/hostnamePattern.js —
// keep both in sync by hand; there's no shared-code path between the two
// stacks in this app.
//
// Site/Team/Tier are closed, policy-defined code lists (unlike
// location/department, which genuinely grow over time and so live in the
// admin-editable dropdown_master instead) — adding a new office or team means
// editing this file (and its frontend mirror), not an admin screen.
const SITE_CODES = {
  Beijing: 'BJS',
  Toronto: 'TOR',
  Burlington: 'BUR',
  'Boston Bomgar': 'BOS',
};

const TEAM_CODES = ['ITO', 'LAB', 'QAT', 'DEV', 'DVO', 'SNP', 'PLT', 'SEC', 'PSE', 'NEA'];
const TIER_CODES = ['P', 'S', 'D', 'T', 'C', 'G'];

// This app's os_type values are coarse platform buckets (Linux / Windows /
// VMware / Proxmox), not free-text OS descriptions. Proxmox is Debian/Linux
// underneath, so it gets 'L'. VMware (ESXi) gets 'E' for the suggested text,
// but see ansibleOsFamily below — there's no Ansible module for ESXi in this
// codebase yet, so the live rename action doesn't support it even though the
// suggested hostname still uses the right letter.
const OS_LETTER = { Linux: 'L', Windows: 'W', VMware: 'E', Proxmox: 'L' };

function osLetter(osType) {
  return OS_LETTER[osType] || null;
}

// Which Ansible play (windows/linux) can execute a live rename for this
// os_type — null means "build the text only, live rename isn't available".
function ansibleOsFamily(osType) {
  if (osType === 'Windows') return 'windows';
  if (osType === 'Linux' || osType === 'Proxmox') return 'linux';
  return null;
}

// Returns the composed hostname string, or null if any input is missing or
// invalid — callers treat null as "can't suggest one yet".
function buildHostname({ location, osType, team, tier, assetTag }) {
  const site = SITE_CODES[location];
  const os = osLetter(osType);
  if (!site || !os) return null;
  if (!team || !TEAM_CODES.includes(team)) return null;
  if (!tier || !TIER_CODES.includes(tier)) return null;
  const digits = String(assetTag || '').replace(/\D/g, '');
  if (digits.length === 0) return null;
  const tag = digits.padStart(4, '0').slice(-4);
  return `${site}${os}${team}${tier}${tag}`;
}

module.exports = { SITE_CODES, TEAM_CODES, TIER_CODES, osLetter, ansibleOsFamily, buildHostname };
