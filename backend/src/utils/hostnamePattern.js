// Which Ansible play (windows/linux) can execute a live hostname rename for
// this os_type — null means "not supported", used by hostnameRenameController.js.
// The actual hostname TEXT (Site+OS+Team+Tier+Tag) is built client-side from
// admin-editable config (see hostnamePatternConfigController.js) — this file
// used to carry a hardcoded mirror of that too, but nothing server-side ever
// read it, so it's gone rather than left to drift out of sync.
function ansibleOsFamily(osType) {
  if (osType === 'Windows') return 'windows';
  if (osType === 'Linux' || osType === 'Proxmox') return 'linux';
  return null;
}

module.exports = { ansibleOsFamily };
