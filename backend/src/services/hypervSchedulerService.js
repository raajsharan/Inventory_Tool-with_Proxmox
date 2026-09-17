/**
 * hypervSchedulerService.js
 * -------------------------
 * Per-host node-cron discovery jobs for Microsoft Hyper-V hosts.
 * Re-fetches host record (with encrypted password) from DB before each run
 * so credentials are never stale in memory.
 */

const cron  = require('node-cron');
const db    = require('./hypervDbService');
const svc   = require('./hypervService');
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
    const cfg = {
      host:      host.host,
      username:  host.username,
      password:  db.getDecryptedPassword(host),
      port:      host.port,
      useSSL:    host.use_ssl,
      verifySSL: host.verify_ssl,
    };
    const vms = await svc.discoverVMs(cfg);
    await db.saveVMs(runId, hostId, host.host, vms);
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
        teams.notifyHostRecovered('Hyper-V', host.host).catch(() => {});
      }

      // Hardware telemetry is a nice-to-have for the Hosts & Credentials
      // table — never let it fail the discovery run itself.
      try {
        const stats = await svc.getHostStats(cfg);
        await db.setHostStats(hostId, stats);
        await utilSvc.checkAndLogHyperV(hostId, host.host, stats);
      } catch (statsErr) {
        console.warn(`[hyperv-scheduler] host stats collection failed for ${host.host}:`, statsErr.message);
      }
    }
  } catch (err) {
    console.error(`[hyperv-scheduler] discovery failed for ${host.host}: ${err.message}`);
    await db.failRun(runId, err.message);

    if (runIds.get(hostId) === runId) {
      const failCount = await db.setLastDiscoveryFailed(hostId, err.message);

      // Notify on every failed attempt — tiered by consecutive-failure count
      // (1st = Warning, 2nd+ = Critical), not just the up -> down transition.
      teams.notifyHostDown('Hyper-V', host.host, err.message, failCount).catch(() => {});
      alertsSvc.logDiscoveryFailure({
        platform: 'Hyper-V', hostId, host: host.host, errorMessage: err.message, failCount,
      }).catch(logErr => console.error(`[hyperv-scheduler] failed to log connectivity alert for ${host.host}:`, logErr.message));
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
  console.log(`[hyperv-scheduler] initialized ${scheduled} job(s) from DB`);
}

module.exports = { runDiscovery, upsert, remove, runNow, stopNow, isRunning, initFromDb };
