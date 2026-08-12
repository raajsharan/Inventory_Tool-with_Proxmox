/**
 * pingMonitorService.js
 * ----------------------
 * Scheduled ICMP connectivity check, independent of each platform's own
 * discovery poll — VMware/Proxmox/Hyper-V hosts each get pinged on their
 * own configurable interval. Consecutive ping failures drive tiered Teams
 * alerts (1st = Warning, 2nd+ = Critical, recovery = Good) via
 * teamsNotificationService, reusing that service's existing per-platform
 * notify_host_down_* toggles.
 */

let cron;
try { cron = require('node-cron'); } catch { cron = null; }

const db    = require('../config/db');
const { ping } = require('../utils/ping');
const teams = require('./teamsNotificationService');

const TABLES = {
  VMware:    'vmware_hosts',
  Proxmox:   'proxmox_hosts',
  'Hyper-V': 'hyperv_hosts',
};

const DEFAULTS = {
  vmware_enabled:           true,
  vmware_interval_minutes:  5,
  proxmox_enabled:          true,
  proxmox_interval_minutes: 5,
  hyperv_enabled:           true,
  hyperv_interval_minutes:  5,
};

async function getConfig() {
  const { rows } = await db.query('SELECT * FROM ping_monitor_config LIMIT 1');
  return rows[0] ? rows[0] : { ...DEFAULTS, id: null };
}

async function saveConfig(fields) {
  const cfg = await getConfig();
  const {
    vmware_enabled           = cfg.vmware_enabled,
    vmware_interval_minutes  = cfg.vmware_interval_minutes,
    proxmox_enabled          = cfg.proxmox_enabled,
    proxmox_interval_minutes = cfg.proxmox_interval_minutes,
    hyperv_enabled           = cfg.hyperv_enabled,
    hyperv_interval_minutes  = cfg.hyperv_interval_minutes,
  } = fields;

  await db.query(
    `INSERT INTO ping_monitor_config
        (vmware_enabled, vmware_interval_minutes, proxmox_enabled, proxmox_interval_minutes,
         hyperv_enabled, hyperv_interval_minutes, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,NOW())
     ON CONFLICT (singleton) DO UPDATE SET
        vmware_enabled           = EXCLUDED.vmware_enabled,
        vmware_interval_minutes  = EXCLUDED.vmware_interval_minutes,
        proxmox_enabled          = EXCLUDED.proxmox_enabled,
        proxmox_interval_minutes = EXCLUDED.proxmox_interval_minutes,
        hyperv_enabled           = EXCLUDED.hyperv_enabled,
        hyperv_interval_minutes  = EXCLUDED.hyperv_interval_minutes,
        updated_at               = NOW()`,
    [vmware_enabled, vmware_interval_minutes, proxmox_enabled, proxmox_interval_minutes,
     hyperv_enabled, hyperv_interval_minutes],
  );

  const updated = await getConfig();
  rescheduleAll(updated);
  return updated;
}

function intervalToCron(minutes) {
  const m = Math.max(1, Math.round(minutes) || 5);
  if (m < 60) return `*/${m} * * * *`;
  const h = Math.floor(m / 60);
  return `0 */${h} * * *`;
}

async function checkPlatform(platform) {
  const table = TABLES[platform];
  if (!table) return;

  const { rows: hosts } = await db.query(
    `SELECT id, host, ping_status, ping_fail_count FROM ${table}`
  );

  for (const h of hosts) {
    let result;
    try {
      result = await ping(h.host);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(`[ping-monitor] ${platform} ping failed for ${h.host}:`, err.message);
      continue;
    }

    if (result.reachable) {
      if (h.ping_status === 'down') {
        teams.notifyPingRecovered(platform, h.host).catch(() => {});
      }
      await db.query(
        `UPDATE ${table} SET ping_status = 'ok', ping_fail_count = 0, ping_last_checked_at = NOW() WHERE id = $1`,
        [h.id]
      );
    } else {
      const failCount = (h.ping_fail_count || 0) + 1;
      await db.query(
        `UPDATE ${table} SET ping_status = 'down', ping_fail_count = $2, ping_last_checked_at = NOW() WHERE id = $1`,
        [h.id, failCount]
      );
      if (failCount === 1) {
        teams.notifyPingWarning(platform, h.host).catch(() => {});
      } else {
        teams.notifyPingCritical(platform, h.host, failCount).catch(() => {});
      }
    }
  }
}

const jobs = {}; // platform -> cron.Task

function schedulePlatform(platform, enabled, intervalMinutes) {
  if (!cron) return;
  if (jobs[platform]) {
    try { jobs[platform].stop(); } catch { /* ignore */ }
    delete jobs[platform];
  }
  if (!enabled) return;

  const expr = intervalToCron(intervalMinutes);
  if (!cron.validate(expr)) {
    // eslint-disable-next-line no-console
    console.warn(`[ping-monitor] invalid cron expr for ${platform}: ${expr}`);
    return;
  }
  jobs[platform] = cron.schedule(expr, () =>
    checkPlatform(platform).catch(err =>
      // eslint-disable-next-line no-console
      console.error(`[ping-monitor] ${platform} check failed:`, err.message)
    )
  );
  // eslint-disable-next-line no-console
  console.log(`[ping-monitor] scheduled ${platform} — ${expr} (every ${intervalMinutes}min)`);
}

function rescheduleAll(cfg) {
  schedulePlatform('VMware',   cfg.vmware_enabled,  cfg.vmware_interval_minutes);
  schedulePlatform('Proxmox',  cfg.proxmox_enabled, cfg.proxmox_interval_minutes);
  schedulePlatform('Hyper-V',  cfg.hyperv_enabled,  cfg.hyperv_interval_minutes);
}

async function initFromDb() {
  if (!cron) {
    // eslint-disable-next-line no-console
    console.warn('[ping-monitor] node-cron not available — ping monitoring disabled');
    return;
  }
  const cfg = await getConfig();
  rescheduleAll(cfg);
}

module.exports = { getConfig, saveConfig, initFromDb, checkPlatform };
