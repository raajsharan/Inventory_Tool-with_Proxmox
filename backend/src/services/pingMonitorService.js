/**
 * pingMonitorService.js
 * ----------------------
 * Scheduled ICMP connectivity check, independent of each platform's own
 * discovery poll — VMware/Proxmox/Hyper-V hosts each get pinged on their
 * own configurable day+time schedule (e.g. "every 1 day at 09:00").
 * Consecutive ping failures drive tiered Teams alerts (1st = Warning,
 * 2nd+ = Critical, re-alerting every check while still down, recovery =
 * Good) via teamsNotificationService, reusing that service's existing
 * per-platform notify_host_down_* toggles.
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
  vmware_enabled:        true,
  vmware_interval_days:  1,
  vmware_check_time:     '09:00',
  proxmox_enabled:       true,
  proxmox_interval_days: 1,
  proxmox_check_time:    '09:00',
  hyperv_enabled:        true,
  hyperv_interval_days:  1,
  hyperv_check_time:     '09:00',
};

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

async function getConfig() {
  const { rows } = await db.query('SELECT * FROM ping_monitor_config LIMIT 1');
  return rows[0] ? rows[0] : { ...DEFAULTS, id: null };
}

async function saveConfig(fields) {
  const cfg = await getConfig();
  const {
    vmware_enabled        = cfg.vmware_enabled,
    vmware_interval_days  = cfg.vmware_interval_days,
    vmware_check_time     = cfg.vmware_check_time,
    proxmox_enabled       = cfg.proxmox_enabled,
    proxmox_interval_days = cfg.proxmox_interval_days,
    proxmox_check_time    = cfg.proxmox_check_time,
    hyperv_enabled        = cfg.hyperv_enabled,
    hyperv_interval_days  = cfg.hyperv_interval_days,
    hyperv_check_time     = cfg.hyperv_check_time,
  } = fields;

  for (const t of [vmware_check_time, proxmox_check_time, hyperv_check_time]) {
    if (!TIME_RE.test(String(t))) throw new Error(`Invalid check time "${t}" — expected HH:MM (24-hour)`);
  }

  await db.query(
    `INSERT INTO ping_monitor_config
        (vmware_enabled, vmware_interval_days, vmware_check_time,
         proxmox_enabled, proxmox_interval_days, proxmox_check_time,
         hyperv_enabled, hyperv_interval_days, hyperv_check_time, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW())
     ON CONFLICT (singleton) DO UPDATE SET
        vmware_enabled        = EXCLUDED.vmware_enabled,
        vmware_interval_days  = EXCLUDED.vmware_interval_days,
        vmware_check_time     = EXCLUDED.vmware_check_time,
        proxmox_enabled       = EXCLUDED.proxmox_enabled,
        proxmox_interval_days = EXCLUDED.proxmox_interval_days,
        proxmox_check_time    = EXCLUDED.proxmox_check_time,
        hyperv_enabled        = EXCLUDED.hyperv_enabled,
        hyperv_interval_days  = EXCLUDED.hyperv_interval_days,
        hyperv_check_time     = EXCLUDED.hyperv_check_time,
        updated_at            = NOW()`,
    [vmware_enabled, vmware_interval_days, vmware_check_time,
     proxmox_enabled, proxmox_interval_days, proxmox_check_time,
     hyperv_enabled, hyperv_interval_days, hyperv_check_time],
  );

  const updated = await getConfig();
  rescheduleAll(updated);
  return updated;
}

// "Every N days at HH:MM" — day-of-month step for N>1 (resets each month
// boundary, a well-known cron limitation for "every N days", accepted here
// since a monitor waking a day early/late once a month is harmless).
function scheduleToCron(intervalDays, checkTime) {
  const [hh, mm] = String(checkTime || '09:00').split(':').map(n => parseInt(n, 10) || 0);
  const days = Math.max(1, Math.round(intervalDays) || 1);
  const dom = days === 1 ? '*' : `*/${days}`;
  return `${mm} ${hh} ${dom} * *`;
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

function schedulePlatform(platform, enabled, intervalDays, checkTime) {
  if (!cron) return;
  if (jobs[platform]) {
    try { jobs[platform].stop(); } catch { /* ignore */ }
    delete jobs[platform];
  }
  if (!enabled) return;

  const expr = scheduleToCron(intervalDays, checkTime);
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
  console.log(`[ping-monitor] scheduled ${platform} — ${expr} (every ${intervalDays} day(s) at ${checkTime})`);
}

function rescheduleAll(cfg) {
  schedulePlatform('VMware',   cfg.vmware_enabled,  cfg.vmware_interval_days,  cfg.vmware_check_time);
  schedulePlatform('Proxmox',  cfg.proxmox_enabled, cfg.proxmox_interval_days, cfg.proxmox_check_time);
  schedulePlatform('Hyper-V',  cfg.hyperv_enabled,  cfg.hyperv_interval_days,  cfg.hyperv_check_time);
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
