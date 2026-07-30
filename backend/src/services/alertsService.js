/**
 * alertsService.js
 * ----------------
 * Aggregates the "current failure" state across every discovery
 * integration (VMware, Proxmox, Hyper-V) into one normalized list, for
 * the dashboard alert bell. A host shows up here when its most recent
 * discovery attempt failed — bad password, unreachable host, timeout,
 * etc. — regardless of which integration it belongs to.
 */

const vmwareDb  = require('./vmwareDbService');
const proxmoxDb = require('./proxmoxDbService');
const hypervDb  = require('./hypervDbService');

// No dedicated error-type column exists on every integration (Hyper-V's
// service only ever throws a plain Error with an augmented message), so
// auth/credential failures are recognized by pattern instead — good enough
// to badge "check the password" vs "check connectivity" in the UI.
const AUTH_PATTERN = /auth(entication)?\s*failed|invalid credentials|unauthorized|401|access denied|invalid.*(password|login)/i;

function toAlert(integration, label, host) {
  return {
    integration,                                   // 'vmware' | 'proxmox' | 'hyperv'
    hostId:        host.id,
    host:          host.display_name || host.host,
    errorMessage:  host.last_error || 'Discovery failed',
    isAuthError:   AUTH_PATTERN.test(host.last_error || ''),
    lastAttemptAt: host.last_attempt_at,
    label,
  };
}

async function getFailedHosts() {
  const [vmwareHosts, proxmoxHosts, hypervHosts] = await Promise.all([
    vmwareDb.listHosts(),
    proxmoxDb.listHosts(),
    hypervDb.listHosts(),
  ]);

  const alerts = [
    ...vmwareHosts.filter(h => h.last_status === 'error').map(h => toAlert('vmware', 'VMware / ESXi', h)),
    ...proxmoxHosts.filter(h => h.last_status === 'error').map(h => toAlert('proxmox', 'Proxmox', h)),
    ...hypervHosts.filter(h => h.last_status === 'error').map(h => toAlert('hyperv', 'Hyper-V', h)),
  ];

  alerts.sort((a, b) => new Date(b.lastAttemptAt || 0) - new Date(a.lastAttemptAt || 0));
  return alerts;
}

module.exports = { getFailedHosts };
