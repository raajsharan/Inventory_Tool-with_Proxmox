// Builds/validates the suggested server hostname shown on the Assets /
// Beijing Assets / Ext. Assets / Physical & ESXi Servers forms' "Suggested
// Hostname" panel: SiteCode(3) + OS(1) + Team(3) + Tier(1) + AssetTag(4),
// e.g. BJSLDEVP0001.
//
// Site/Team/Tier codes used to be a hardcoded closed list here — they're now
// admin-editable (Administration > Dropdown Master > Hostname Naming
// Pattern), fetched at runtime via useHostnamePatternConfig() and passed
// into the functions below. This file keeps only the OS-letter mapping,
// which the naming spec treats as fixed per os_type rather than policy that
// changes per office/team.
export const OS_LETTER = { Linux: 'L', Windows: 'W', VMware: 'E', Proxmox: 'L' };

export function osLetter(osType) {
  return OS_LETTER[osType] || null;
}

// The 5 segments a hostname is composed of. Order is admin-editable
// (Dropdown Master > Hostname Naming Pattern) — SEGMENT_ORDER_DEFAULT is the
// original fixed order, kept as the fallback whenever a stored segment_order
// is missing or invalid (not all 5 keys present exactly once).
export const SEGMENT_KEYS = ['site', 'os', 'team', 'tier', 'asset_tag'];
export const SEGMENT_LABELS = {
  site: 'Site', os: 'OS', team: 'Team', tier: 'Tier', asset_tag: 'Asset Tag',
};
export const SEGMENT_ORDER_DEFAULT = SEGMENT_KEYS;

export function isValidSegmentOrder(order) {
  return Array.isArray(order) && order.length === SEGMENT_KEYS.length
    && SEGMENT_KEYS.every(k => order.includes(k));
}

// Best-effort guess at a department's Team code, purely to pre-fill the
// (still user-editable) Team select — asset managers confirm or correct it,
// nothing here is authoritative. Matched by keyword rather than exact name
// since departments are admin-defined free text, not a fixed enum. Returns
// null (no guess) if the matched code isn't in the admin's current team list.
export function guessTeamFromDepartment(departmentName, teamCodes = []) {
  const d = (departmentName || '').toLowerCase();
  let guess = null;
  if (d.includes('lab')) guess = 'LAB';
  else if (d.includes('qa')) guess = 'QAT';
  else if (d.includes('devops') || d.includes('dev-ops') || d.includes('dev ops')) guess = 'DVO';
  else if (d.includes('dev')) guess = 'DEV';
  else if (d.includes('support') || d.includes('service')) guess = 'SNP';
  else if (d.includes('platform')) guess = 'PLT';
  else if (d.includes('security')) guess = 'SEC';
  else if (d.includes('pre-sales') || d.includes('presales') || d.includes('sales')) guess = 'PSE';
  else if (d.includes('network')) guess = 'NEA';
  else if (d.includes('it')) guess = 'ITO';
  if (!guess) return null;
  return teamCodes.some(t => t.code === guess) ? guess : null;
}

// Returns the composed hostname string, or null if any input (including the
// admin-configured code maps themselves) is missing — callers treat null as
// "can't suggest one yet".
export function buildHostname({ location, osType, team, tier, assetTag, siteCodes = {}, segmentOrder }) {
  const site = siteCodes[location];
  const os = osLetter(osType);
  const digits = String(assetTag || '').replace(/\D/g, '');
  if (!site || !os || !team || !tier || digits.length === 0) return null;
  const tag = digits.padStart(4, '0').slice(-4);
  const order = isValidSegmentOrder(segmentOrder) ? segmentOrder : SEGMENT_ORDER_DEFAULT;
  const parts = { site, os, team, tier, asset_tag: tag };
  return order.map(k => parts[k]).join('');
}
