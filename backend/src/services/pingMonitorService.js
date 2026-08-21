/**
 * pingMonitorService.js
 * ----------------------
 * Scheduled connectivity check, independent of each platform's own
 * discovery poll — VMware/Proxmox/Hyper-V hosts each get checked on their
 * own configurable minute interval, restricted to an optional active
 * window (Start Time - End Time) and active days of the week; a check
 * tick outside either is skipped entirely.
 *
 * VMware and Proxmox hosts get a dual check — ICMP ping plus an SSH login
 * attempt using the host's existing stored credentials — and are only
 * considered down when BOTH fail, to avoid alerting on ICMP being blocked
 * while the host is actually reachable (or vice versa). Hyper-V hosts use
 * WinRM, not SSH, so they remain ping-only. Consecutive failures of the
 * combined check drive tiered Teams alerts (1st = Warning, 2nd+ = Critical,
 * re-alerting every check while still down, recovery = Good) via
 * teamsNotificationService, reusing that service's existing per-platform
 * notify_host_down_* toggles. The alert itself reports which check(s)
 * failed.
 */

let cron;
try { cron = require('node-cron'); } catch { cron = null; }

const { Client } = require('ssh2');
const db     = require('../config/db');
const { ping } = require('../utils/ping');
const crypto = require('../utils/crypto');
const teams  = require('./teamsNotificationService');

const TABLES = {
  VMware:    'vmware_hosts',
  Proxmox:   'proxmox_hosts',
  'Hyper-V': 'hyperv_hosts',
};

// Platforms whose host credentials support an SSH login check (VMware ESXi
// root / vCenter appliance and Proxmox root/PAM both typically allow SSH).
// Hyper-V hosts are managed over WinRM, not SSH, so they stay ping-only.
const SSH_CHECK_PLATFORMS = new Set(['VMware', 'Proxmox']);

// Platform -> its config field names for the active window.
const WINDOW_FIELDS = {
  VMware:    ['vmware_window_start',  'vmware_window_end'],
  Proxmox:   ['proxmox_window_start', 'proxmox_window_end'],
  'Hyper-V': ['hyperv_window_start',  'hyperv_window_end'],
};

// Platform -> its config field name for the active-days gate.
const ACTIVE_DAYS_FIELDS = {
  VMware:    'vmware_active_days',
  Proxmox:   'proxmox_active_days',
  'Hyper-V': 'hyperv_active_days',
};

const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];

const DEFAULTS = {
  vmware_enabled:         true,
  vmware_interval_minutes: 5,
  vmware_window_start:    '00:00',
  vmware_window_end:      '23:59',
  vmware_active_days:     ALL_DAYS,
  proxmox_enabled:        true,
  proxmox_interval_minutes: 5,
  proxmox_window_start:   '00:00',
  proxmox_window_end:     '23:59',
  proxmox_active_days:    ALL_DAYS,
  hyperv_enabled:         true,
  hyperv_interval_minutes: 5,
  hyperv_window_start:    '00:00',
  hyperv_window_end:      '23:59',
  hyperv_active_days:     ALL_DAYS,
};

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

async function getConfig() {
  const { rows } = await db.query('SELECT * FROM ping_monitor_config LIMIT 1');
  return rows[0] ? rows[0] : { ...DEFAULTS, id: null };
}

function validActiveDays(days) {
  return Array.isArray(days) && days.every(d => Number.isInteger(d) && d >= 0 && d <= 6);
}

async function saveConfig(fields) {
  const cfg = await getConfig();
  const {
    vmware_enabled          = cfg.vmware_enabled,
    vmware_interval_minutes = cfg.vmware_interval_minutes,
    vmware_window_start     = cfg.vmware_window_start,
    vmware_window_end       = cfg.vmware_window_end,
    vmware_active_days      = cfg.vmware_active_days,
    proxmox_enabled          = cfg.proxmox_enabled,
    proxmox_interval_minutes = cfg.proxmox_interval_minutes,
    proxmox_window_start     = cfg.proxmox_window_start,
    proxmox_window_end       = cfg.proxmox_window_end,
    proxmox_active_days      = cfg.proxmox_active_days,
    hyperv_enabled          = cfg.hyperv_enabled,
    hyperv_interval_minutes = cfg.hyperv_interval_minutes,
    hyperv_window_start     = cfg.hyperv_window_start,
    hyperv_window_end       = cfg.hyperv_window_end,
    hyperv_active_days      = cfg.hyperv_active_days,
  } = fields;

  for (const t of [vmware_window_start, vmware_window_end, proxmox_window_start, proxmox_window_end,
                    hyperv_window_start, hyperv_window_end]) {
    if (!TIME_RE.test(String(t))) throw new Error(`Invalid window time "${t}" — expected HH:MM (24-hour)`);
  }
  for (const days of [vmware_active_days, proxmox_active_days, hyperv_active_days]) {
    if (!validActiveDays(days)) throw new Error('Invalid active days — expected an array of integers 0-6 (Sunday-Saturday)');
  }

  await db.query(
    `INSERT INTO ping_monitor_config
        (vmware_enabled, vmware_interval_minutes, vmware_window_start, vmware_window_end, vmware_active_days,
         proxmox_enabled, proxmox_interval_minutes, proxmox_window_start, proxmox_window_end, proxmox_active_days,
         hyperv_enabled, hyperv_interval_minutes, hyperv_window_start, hyperv_window_end, hyperv_active_days, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,NOW())
     ON CONFLICT (singleton) DO UPDATE SET
        vmware_enabled          = EXCLUDED.vmware_enabled,
        vmware_interval_minutes = EXCLUDED.vmware_interval_minutes,
        vmware_window_start     = EXCLUDED.vmware_window_start,
        vmware_window_end       = EXCLUDED.vmware_window_end,
        vmware_active_days      = EXCLUDED.vmware_active_days,
        proxmox_enabled          = EXCLUDED.proxmox_enabled,
        proxmox_interval_minutes = EXCLUDED.proxmox_interval_minutes,
        proxmox_window_start     = EXCLUDED.proxmox_window_start,
        proxmox_window_end       = EXCLUDED.proxmox_window_end,
        proxmox_active_days      = EXCLUDED.proxmox_active_days,
        hyperv_enabled          = EXCLUDED.hyperv_enabled,
        hyperv_interval_minutes = EXCLUDED.hyperv_interval_minutes,
        hyperv_window_start     = EXCLUDED.hyperv_window_start,
        hyperv_window_end       = EXCLUDED.hyperv_window_end,
        hyperv_active_days      = EXCLUDED.hyperv_active_days,
        updated_at              = NOW()`,
    [vmware_enabled, vmware_interval_minutes, vmware_window_start, vmware_window_end, vmware_active_days,
     proxmox_enabled, proxmox_interval_minutes, proxmox_window_start, proxmox_window_end, proxmox_active_days,
     hyperv_enabled, hyperv_interval_minutes, hyperv_window_start, hyperv_window_end, hyperv_active_days],
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

// Supports an overnight window (e.g. start 22:00, end 06:00).
function isWithinWindow(start, end) {
  const [sh, sm] = String(start || '00:00').split(':').map(Number);
  const [eh, em] = String(end   || '23:59').split(':').map(Number);
  const startMins = sh * 60 + sm;
  const endMins   = eh * 60 + em;

  const now = new Date();
  const nowMins = now.getHours() * 60 + now.getMinutes();

  if (startMins <= endMins) return nowMins >= startMins && nowMins <= endMins;
  return nowMins >= startMins || nowMins <= endMins;
}

// Lightweight SSH reachability probe — just needs a successful auth, not a
// command result, so it resolves as soon as the session is 'ready'.
function sshCheck(host, username, password, timeout = 6000) {
  return new Promise((resolve) => {
    const conn = new Client();
    let settled = false;
    const finish = (ok) => {
      if (settled) return;
      settled = true;
      try { conn.end(); } catch { /* ignore */ }
      resolve(ok);
    };
    const timer = setTimeout(() => {
      try { conn.destroy(); } catch { /* ignore */ }
      finish(false);
    }, timeout + 1000);

    conn.on('ready', () => { clearTimeout(timer); finish(true); });
    conn.on('error', () => { clearTimeout(timer); finish(false); });

    try {
      conn.connect({ host, port: 22, username, password, readyTimeout: timeout });
    } catch {
      clearTimeout(timer);
      finish(false);
    }
  });
}

async function checkPlatform(platform) {
  const table = TABLES[platform];
  if (!table) return;

  const cfg = await getConfig();
  const [startKey, endKey] = WINDOW_FIELDS[platform] || [];
  if (startKey && !isWithinWindow(cfg[startKey], cfg[endKey])) return; // outside this platform's active window

  const activeDays = cfg[ACTIVE_DAYS_FIELDS[platform]] || ALL_DAYS;
  if (!activeDays.includes(new Date().getDay())) return; // not an active day for this platform

  const useSsh = SSH_CHECK_PLATFORMS.has(platform);
  const { rows: hosts } = await db.query(
    `SELECT id, host, username, password_encrypted, ping_status, ping_fail_count FROM ${table}`
  );

  for (const h of hosts) {
    let pingOk = false;
    try {
      const result = await ping(h.host);
      pingOk = !!result.reachable;
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(`[ping-monitor] ${platform} ping failed for ${h.host}:`, err.message);
    }

    // SSH is only consulted when ping already failed (dual-check exists to
    // confirm a real outage, not to second-guess a healthy ping) and only
    // when this platform supports it and the host has stored credentials.
    let sshOk = null; // null = not checked / not applicable
    let reachable = pingOk;

    if (!pingOk && useSsh && h.username && h.password_encrypted) {
      let password = null;
      try { password = crypto.decrypt(h.password_encrypted); } catch { /* ignore */ }
      if (password) {
        sshOk = await sshCheck(h.host, h.username, password);
        reachable = sshOk;
      }
    }

    if (reachable) {
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
      const checks = { ping: pingOk, ssh: sshOk };
      if (failCount === 1) {
        teams.notifyPingWarning(platform, h.host, checks).catch(() => {});
      } else {
        teams.notifyPingCritical(platform, h.host, failCount, checks).catch(() => {});
      }
    }
  }
}

const jobs = {}; // platform -> cron.Task

function schedulePlatform(platform, enabled, intervalMinutes, windowStart, windowEnd) {
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
  console.log(`[ping-monitor] scheduled ${platform} — ${expr} (every ${intervalMinutes}min, active ${windowStart}-${windowEnd})`);
}

function rescheduleAll(cfg) {
  schedulePlatform('VMware',  cfg.vmware_enabled,  cfg.vmware_interval_minutes,  cfg.vmware_window_start,  cfg.vmware_window_end);
  schedulePlatform('Proxmox', cfg.proxmox_enabled, cfg.proxmox_interval_minutes, cfg.proxmox_window_start, cfg.proxmox_window_end);
  schedulePlatform('Hyper-V', cfg.hyperv_enabled,  cfg.hyperv_interval_minutes,  cfg.hyperv_window_start,  cfg.hyperv_window_end);
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
