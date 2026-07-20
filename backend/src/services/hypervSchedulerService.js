/**
 * hypervSchedulerService.js
 * -------------------------
 * Per-host node-cron discovery jobs for Microsoft Hyper-V hosts.
 * Re-fetches host record (with encrypted password) from DB before each run
 * so credentials are never stale in memory.
 */

const cron = require('node-cron');
const db   = require('./hypervDbService');
const svc  = require('./hypervService');

const jobs    = new Map();   // hostId → CronTask
const running = new Set();   // hostId values currently running

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
    await db.setLastDiscovery(hostId, vms.length);
  } catch (err) {
    console.error(`[hyperv-scheduler] discovery failed for ${host.host}: ${err.message}`);
    await db.failRun(runId, err.message);
    await db.setLastDiscoveryFailed(hostId, err.message);
  } finally {
    running.delete(hostId);
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

module.exports = { runDiscovery, upsert, remove, runNow, isRunning, initFromDb };
