// Each hypervisor serves its web UI somewhere different: Proxmox on port
// 8006, ESXi at /ui on 443. Anything else — including a host whose type we
// don't know — keeps the ESXi form, which is what every row used before the
// two were told apart.
//
// Shared by Physical & ESXi Servers (where the row IS the host, so it passes
// that row's own os_type) and the VM lists (where the row is a guest, so
// they pass hosted_os_type: the type of the host behind hosted_ip, resolved
// server-side — the VM's own os_type says nothing about its hypervisor).
export function webUiUrl(ip, osType) {
  return /proxmox/i.test(osType || '') ? `https://${ip}:8006` : `https://${ip}/ui/`;
}
