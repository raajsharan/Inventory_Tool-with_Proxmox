/**
 * vmwareSchedulerService.js
 * -------------------------
 * Manages per-host scheduled VMware discovery jobs using node-cron.
 * Each vCenter/ESXi host can have an independent discovery interval.
 */

let cron;
try { cron = require('node-cron'); } catch { cron = null; }

const vmSvc  = require('./vmwareService');
const dbSvc  = require('./vmwareDbService');
const teams  = require('./teamsNotificationService');
const utilSvc = require('./hostUtilizationService');
const alertsSvc = require('./hostAlertsService');

const jobs = {};       // host -> cron.Task
const running = new Set();  // hosts currently being discovered
const runIds  = new Map();  // host -> current discovery_runs.id, while running

function intervalToCron(minutes) {
  if (minutes < 60) return `*/${Math.max(5, minutes)} * * * *`;
  const h = Math.floor(minutes / 60);
  return `0 */${h} * * *`;
}

async function runDiscovery(host) {
  if (running.has(host)) {
    // eslint-disable-next-line no-console
    console.log(`[vmware-scheduler] ${host} already running — skipped`);
    return;
  }

  const record = await dbSvc.getHostByName(host);
  if (!record) return;

  const password = dbSvc.getDecryptedPassword(record);
  running.add(host);
  await dbSvc.setHostRunning(record.id, true);
  let runId;

  try {
    runId = await dbSvc.startRun(record.id, host);
    runIds.set(host, runId);
    // eslint-disable-next-line no-console
    console.log(`[vmware-scheduler] starting discovery for ${host}`);

    const vms = await vmSvc.discover(host, record.port, record.username, password, record.verify_ssl);
    await dbSvc.saveVMs(runId, record.id, host, vms);
    await dbSvc.finishRun(runId, vms.length);

    // A stopNow() call (or a fresh runNow() started after one) may have
    // already moved runIds past this run — everything below here only
    // touches the host's *live displayed* status, so it's skipped once this
    // run has been superseded, rather than clobbering the newer state with a
    // stale result from a run the admin already gave up on.
    if (runIds.get(host) === runId) {
      await dbSvc.setLastDiscovery(record.id, vms.length);

      // Notify only on the down -> up transition, not every successful poll.
      if (record.last_status === 'error') {
        teams.notifyHostRecovered('VMware', host).catch(() => {});
      }

      // Hardware telemetry (CPU/RAM/disk/uptime) is a nice-to-have for the
      // Hosts & Credentials table — never let it fail the discovery run itself.
      // Row-level columns only make sense for a standalone ESXi host (exactly
      // one under management); a vCenter with several gets the per-host
      // breakdown instead (see getEsxiHostStats / the expandable row).
      try {
        const allStats = await vmSvc.getAllHostStats(host, record.port, record.username, password, record.verify_ssl);
        await dbSvc.setEsxiHostStats(record.id, allStats);
        if (allStats.length === 1) await dbSvc.setHostStats(record.id, allStats[0]);
        else await dbSvc.clearHostStats(record.id);
        await utilSvc.checkAndLogVMware(record.id, allStats);
      } catch (statsErr) {
        // eslint-disable-next-line no-console
        console.warn(`[vmware-scheduler] host stats collection failed for ${host}:`, statsErr.message);
      }
    }

    // eslint-disable-next-line no-console
    console.log(`[vmware-scheduler] ${host} complete — ${vms.length} VMs`);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(`[vmware-scheduler] ${host} failed:`, err.message);
    if (runId) await dbSvc.failRun(runId, err.message);

    if (runIds.get(host) === runId) {
      const failCount = await dbSvc.setLastDiscoveryFailed(record.id, err.message);

      // Notify on every failed attempt — tiered by consecutive-failure count
      // (1st = Warning, 2nd+ = Critical), not just the up -> down transition.
      teams.notifyHostDown('VMware', host, err.message, failCount).catch(() => {});
      alertsSvc.logDiscoveryFailure({
        platform: 'VMware', hostId: record.id, host, errorMessage: err.message, failCount,
      }).catch(logErr => console.error(`[vmware-scheduler] failed to log connectivity alert for ${host}:`, logErr.message));
    }
  } finally {
    // Only clear if this is still the run that's tracked — a stopNow() call
    // (or a fresh runNow() started after one) may have already moved on,
    // and this now-orphaned promise finishing later shouldn't clobber that
    // newer state.
    if (runIds.get(host) === runId) {
      running.delete(host);
      runIds.delete(host);
    }
  }
}

function upsert(host, intervalMinutes, enabled) {
  if (!cron) return;

  // Stop existing job
  if (jobs[host]) {
    try { jobs[host].stop(); } catch {}
    delete jobs[host];
  }

  if (!enabled) return;

  const expr = intervalToCron(intervalMinutes);
  if (!cron.validate(expr)) {
    // eslint-disable-next-line no-console
    console.warn(`[vmware-scheduler] invalid cron expr for ${host}: ${expr}`);
    return;
  }

  jobs[host] = cron.schedule(expr, () => runDiscovery(host));
  // eslint-disable-next-line no-console
  console.log(`[vmware-scheduler] scheduled ${host} — ${expr} (every ${intervalMinutes}min)`);
}

function remove(host) {
  if (jobs[host]) {
    try { jobs[host].stop(); } catch {}
    delete jobs[host];
  }
}

function activeHosts() {
  return [...running];
}

function isRunning(host) {
  return running.has(host);
}

async function runNow(host) {
  setImmediate(() => runDiscovery(host));
}

// Force-stop: clears the running state so the UI/scheduler treat this host
// as idle again and a new run can start immediately. Doesn't actually abort
// the in-flight HTTPS/SOAP calls the old run is waiting on (there are no
// cancellation hooks threaded through vmwareService today) — that promise
// still runs to completion or failure in the background, but its result is
// discarded by the runId guard in runDiscovery's finally block above. Mainly
// for unsticking a host stuck showing "Running" after a hang/crash.
async function stopNow(host) {
  if (!running.has(host)) return false;
  const runId = runIds.get(host);
  running.delete(host);
  runIds.delete(host);
  const record = await dbSvc.getHostByName(host);
  if (record) await dbSvc.setLastDiscoveryFailed(record.id, 'Stopped by admin');
  if (runId) await dbSvc.failRun(runId, 'Stopped by admin');
  return true;
}

// Re-hydrate all enabled schedules from DB on startup
async function initFromDb() {
  if (!cron) {
    // eslint-disable-next-line no-console
    console.warn('[vmware-scheduler] node-cron not available — scheduled VMware discovery disabled');
    return;
  }
  try {
    const hosts = await dbSvc.listHosts();
    for (const h of hosts) {
      if (h.scheduler_enabled) {
        upsert(h.host, h.interval_minutes, true);
      }
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[vmware-scheduler] failed to init from DB:', err.message);
  }
}

module.exports = { upsert, remove, activeHosts, isRunning, runNow, stopNow, initFromDb, runDiscovery };
