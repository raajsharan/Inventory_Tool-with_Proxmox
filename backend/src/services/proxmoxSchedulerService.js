/**
 * proxmoxSchedulerService.js
 * --------------------------
 * Per-host node-cron discovery jobs for Proxmox VE / PDM.
 * Re-fetches host record (with encrypted password) from DB before each run
 * so credentials are never stale in memory.
 */

const cron  = require('node-cron');
const db    = require('./proxmoxDbService');
const pxSvc = require('./proxmoxService');
const teams = require('./teamsNotificationService');
const utilSvc = require('./hostUtilizationService');
const alertsSvc = require('./hostAlertsService');

const jobs    = new Map();   // hostId → CronTask
const running = new Set();   // hostId values currently running
const runIds  = new Map();   // hostId → current discovery_runs.id, while running

function intervalToCron(minutes) {
  if (minutes < 60) return `*/${Math.max(1, minutes)} * * * *`;
  const hours = Math.floor(minutes / 60);
  return `0 */${hours} * * *`;
}

async function runDiscovery(hostId) {
  if (running.has(hostId)) return;
  running.add(hostId);

  // Always re-fetch to get encrypted password from DB
  const host = await db.getHostById(hostId);
  if (!host) { running.delete(hostId); return; }

  await db.setHostRunning(hostId, true);
  const runId = await db.startRun(hostId, host.host);
  runIds.set(hostId, runId);

  try {
    const password    = db.getDecryptedPassword(host);
    const tokenSecret = db.getDecryptedTokenSecret(host);
    const { vms, nodes } = await pxSvc.discover(
      host.host, host.port,
      host.username, host.realm,
      password, host.verify_ssl, host.host_type,
      host.token_id || null, tokenSecret
    );
    await db.saveVMs(runId, hostId, host.host, vms);
    await db.saveNodes(runId, hostId, host.host, nodes);
    // Never let utilization-alert logging fail the discovery run itself —
    // same defensive stance as the stats-collection blocks in the VMware/
    // Hyper-V schedulers (which already have their own nested try/catch).
    try {
      await utilSvc.checkAndLogProxmox(hostId, nodes);
    } catch (utilErr) {
      console.warn(`[proxmox-scheduler] utilization check failed for ${host.host}:`, utilErr.message);
    }
    await db.finishRun(runId, vms.length);

    // A stopNow() call (or a fresh runNow() started after one) may have
    // already moved runIds past this run — everything below here only
    // touches the host's *live displayed* status, so it's skipped once this
    // run has been superseded, rather than clobbering the newer state with a
    // stale result from a run the admin already gave up on.
    if (runIds.get(hostId) === runId) {
      await db.setLastDiscovery(hostId, vms.length);

      // Notify only on the down -> up transition, not every successful poll.
      if (host.last_status === 'error') {
        teams.notifyHostRecovered('Proxmox', host.host).catch(() => {});
      }
    }
  } catch (err) {
    console.error(`[proxmox-scheduler] discovery failed for ${host.host}: ${err.message}`);
    await db.failRun(runId, err.message);

    if (runIds.get(hostId) === runId) {
      const failCount = await db.setLastDiscoveryFailed(hostId, err.message);

      // Notify on every failed attempt — tiered by consecutive-failure count
      // (1st = Warning, 2nd+ = Critical), not just the up -> down transition.
      teams.notifyHostDown('Proxmox', host.host, err.message, failCount).catch(() => {});
      alertsSvc.logDiscoveryFailure({
        platform: 'Proxmox', hostId, host: host.host, errorMessage: err.message, failCount,
      }).catch(logErr => console.error(`[proxmox-scheduler] failed to log connectivity alert for ${host.host}:`, logErr.message));
    }
  } finally {
    // Only clear if this is still the tracked run — see stopNow() below.
    if (runIds.get(hostId) === runId) {
      running.delete(hostId);
      runIds.delete(hostId);
    }
  }
}

function upsert(host, intervalMinutes, enabled) {
  const id = host.id;
  if (jobs.has(id)) { jobs.get(id).stop(); jobs.delete(id); }
  if (!enabled) return;
  const expr = intervalToCron(intervalMinutes || 60);
  const task = cron.schedule(expr, () => runDiscovery(id));
  jobs.set(id, task);
}

function remove(hostId) {
  if (jobs.has(hostId)) { jobs.get(hostId).stop(); jobs.delete(hostId); }
}

function runNow(hostId) {
  setImmediate(() => runDiscovery(hostId));
}

function isRunning(hostId) {
  return running.has(hostId);
}

// Force-stop: clears the running state so a new run can start immediately.
// Doesn't abort the in-flight discovery calls themselves (no cancellation
// hooks today) — see the matching comment in vmwareSchedulerService.js.
async function stopNow(hostId) {
  if (!running.has(hostId)) return false;
  const runId = runIds.get(hostId);
  running.delete(hostId);
  runIds.delete(hostId);
  await db.setLastDiscoveryFailed(hostId, 'Stopped by admin');
  if (runId) await db.failRun(runId, 'Stopped by admin');
  return true;
}

async function initFromDb() {
  const hosts = await db.listHosts();
  let scheduled = 0;
  for (const h of hosts) {
    if (h.scheduler_enabled) {
      upsert(h, h.interval_minutes, true);
      scheduled++;
    }
  }
  console.log(`[proxmox-scheduler] initialized ${scheduled} job(s) from DB`);
}

module.exports = { runDiscovery, upsert, remove, runNow, stopNow, isRunning, initFromDb };
