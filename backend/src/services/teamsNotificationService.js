/**
 * teamsNotificationService.js
 * Sends Adaptive Card notifications to a Microsoft Teams channel via
 * an Incoming Webhook (Teams Workflows / Power Automate).
 */
const https = require('https');
const http  = require('http');
const db    = require('../config/db');

// ── HTTP helper ───────────────────────────────────────────────────────────────

function postJson(urlStr, body) {
  return new Promise((resolve, reject) => {
    const parsed  = new URL(urlStr);
    const isHttps = parsed.protocol === 'https:';
    const lib     = isHttps ? https : http;
    const payload = JSON.stringify(body);
    const opts = {
      hostname: parsed.hostname,
      port:     parsed.port || (isHttps ? 443 : 80),
      path:     parsed.pathname + parsed.search,
      method:   'POST',
      headers:  {
        'Content-Type':   'application/json',
        'Content-Length': Buffer.byteLength(payload),
      },
    };
    const req = lib.request(opts, (res) => {
      let raw = '';
      res.on('data', d => { raw += d; });
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(raw);
        } else {
          reject(new Error(`Teams webhook HTTP ${res.statusCode}: ${raw.slice(0, 200)}`));
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(10000, () => { req.destroy(new Error('Teams webhook request timed out')); });
    req.write(payload);
    req.end();
  });
}

// ── Config CRUD ───────────────────────────────────────────────────────────────

const DEFAULTS = {
  webhook_url:           '',
  enabled:               false,
  notify_new_asset:      true,
  notify_asset_update:   true,
  notify_decommission:   true,
  notify_migration_status: true,
  notify_host_down_vmware:  true,
  notify_host_down_proxmox: true,
  notify_host_down_hyperv:  true,
  alert_window_enabled:  false,
  alert_window_start:    '00:00',
  alert_window_end:      '23:59',
};

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

async function getConfig() {
  const { rows } = await db.query('SELECT * FROM teams_notification_config LIMIT 1');
  return rows[0] ? rows[0] : { ...DEFAULTS, id: null };
}

async function saveConfig(fields) {
  const cfg = await getConfig();
  const {
    webhook_url           = cfg.webhook_url,
    enabled               = cfg.enabled,
    notify_new_asset      = cfg.notify_new_asset,
    notify_asset_update   = cfg.notify_asset_update,
    notify_decommission   = cfg.notify_decommission,
    notify_migration_status  = cfg.notify_migration_status,
    notify_host_down_vmware  = cfg.notify_host_down_vmware,
    notify_host_down_proxmox = cfg.notify_host_down_proxmox,
    notify_host_down_hyperv  = cfg.notify_host_down_hyperv,
    alert_window_enabled     = cfg.alert_window_enabled,
    alert_window_start       = cfg.alert_window_start,
    alert_window_end         = cfg.alert_window_end,
  } = fields;

  if (alert_window_enabled) {
    for (const t of [alert_window_start, alert_window_end]) {
      if (!TIME_RE.test(String(t))) throw new Error(`Invalid alert window time "${t}" — expected HH:MM (24-hour)`);
    }
  }

  await db.query(
    `INSERT INTO teams_notification_config
        (webhook_url, enabled, notify_new_asset, notify_asset_update,
         notify_decommission, notify_migration_status,
         notify_host_down_vmware, notify_host_down_proxmox, notify_host_down_hyperv,
         alert_window_enabled, alert_window_start, alert_window_end, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,NOW())
     ON CONFLICT (singleton) DO UPDATE SET
        webhook_url              = EXCLUDED.webhook_url,
        enabled                  = EXCLUDED.enabled,
        notify_new_asset         = EXCLUDED.notify_new_asset,
        notify_asset_update      = EXCLUDED.notify_asset_update,
        notify_decommission      = EXCLUDED.notify_decommission,
        notify_migration_status  = EXCLUDED.notify_migration_status,
        notify_host_down_vmware  = EXCLUDED.notify_host_down_vmware,
        notify_host_down_proxmox = EXCLUDED.notify_host_down_proxmox,
        notify_host_down_hyperv  = EXCLUDED.notify_host_down_hyperv,
        alert_window_enabled     = EXCLUDED.alert_window_enabled,
        alert_window_start       = EXCLUDED.alert_window_start,
        alert_window_end         = EXCLUDED.alert_window_end,
        updated_at               = NOW()`,
    [webhook_url, enabled, notify_new_asset, notify_asset_update,
     notify_decommission, notify_migration_status,
     notify_host_down_vmware, notify_host_down_proxmox, notify_host_down_hyperv,
     alert_window_enabled, alert_window_start, alert_window_end],
  );
  return getConfig();
}

// ── Adaptive Card helpers ─────────────────────────────────────────────────────

function colorForStatus(status) {
  const s = String(status || '').toLowerCase();
  if (s === 'completed' || s === 'cleaned up' || s === 'migrated') return 'Good';
  if (s === 'blocked' || s === 'to be deleted' || s.includes('decom')) return 'Attention';
  if (s === 'in progress') return 'Accent';
  if (s === 'awaiting confirmation') return 'Warning';
  return 'Default';
}

function buildCard({ title, color = 'Default', facts = [], subtitle = null, changesText = null }) {
  const body = [];

  if (subtitle) {
    body.push({
      type: 'TextBlock',
      text: subtitle,
      size: 'Small',
      color: 'Accent',
      spacing: 'None',
    });
  }

  body.push({
    type: 'TextBlock',
    text: title,
    weight: 'Bolder',
    size: 'Medium',
    color,
    wrap: true,
  });

  if (facts.length) {
    body.push({
      type: 'FactSet',
      facts: facts.filter(f => f.value != null && f.value !== ''),
    });
  }

  if (changesText) {
    body.push({
      type: 'TextBlock',
      text: changesText,
      wrap: true,
      spacing: 'Medium',
      size: 'Small',
    });
  }

  return {
    type: 'message',
    attachments: [{
      contentType: 'application/vnd.microsoft.card.adaptive',
      content: {
        $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
        type:    'AdaptiveCard',
        version: '1.4',
        body,
      },
    }],
  };
}

async function send(card) {
  const cfg = await getConfig();
  if (!cfg.enabled || !cfg.webhook_url) return;
  await postJson(cfg.webhook_url, card);
}

// ── Field-change diff helper ───────────────────────────────────────────────────
// Compares the before/after asset rows and lists which user-facing fields
// actually changed, so the Teams card shows what was modified rather than
// just a generic "Asset Updated" line.

const DIFF_IGNORE_KEYS = new Set([
  'id', 'created_at', 'updated_at', 'created_by', 'updated_by',
  'created_by_name', 'updated_by_name', 'deleted_at',
  'decommissioned_at', 'decommissioned_by',
  'asset_password', 'asset_password_encrypted', 'extras',
]);

function fmtFieldValue(v) {
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  return String(v);
}

function fieldLabel(key) {
  return key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function diffAssetFields(before, after) {
  if (!before || !after) return [];
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  const changes = [];
  for (const key of keys) {
    if (DIFF_IGNORE_KEYS.has(key)) continue;
    const oldVal = before[key] ?? null;
    const newVal = after[key]  ?? null;
    if (String(oldVal ?? '') === String(newVal ?? '')) continue;
    changes.push(`${fieldLabel(key)}: ${fmtFieldValue(oldVal)} → ${fmtFieldValue(newVal)}`);
  }
  return changes;
}

// ── Source label helper ───────────────────────────────────────────────────────

function sourceLabel(source) {
  return {
    assets:                'Asset Inventory',
    beijing_assets:        'Beijing Assets',
    ext_assets:            'Ext. Assets',
    physical_esxi_servers: 'Physical / ESXi',
  }[source] || source;
}

// ── Public notify* functions ──────────────────────────────────────────────────

async function notifyNewAsset(asset, source = 'assets', updatedBy = null) {
  const cfg = await getConfig();
  if (!cfg.enabled || !cfg.notify_new_asset || !cfg.webhook_url) return;

  const card = buildCard({
    subtitle: `📋 ${sourceLabel(source)}`,
    title: `New Asset Registered: ${asset.vm_name || asset.hostname || asset.id}`,
    color: 'Accent',
    facts: [
      { title: 'Asset Name',  value: asset.vm_name || asset.hostname },
      { title: 'IP Address',  value: asset.ip_address },
      { title: 'Inventory',   value: sourceLabel(source) },
      { title: 'OS Type',     value: asset.os_type },
      { title: 'Location',    value: asset.location },
      { title: 'Department',  value: asset.department },
      { title: 'Asset Tag',   value: asset.asset_tag },
      { title: 'Registered By', value: updatedBy },
    ],
  });
  await send(card);
}

async function notifyAssetUpdate(before, asset, source = 'assets', updatedBy = null) {
  const cfg = await getConfig();
  if (!cfg.enabled || !cfg.notify_asset_update || !cfg.webhook_url) return;

  const changes = diffAssetFields(before, asset);
  if (!changes.length) return; // nothing user-facing actually changed — skip the noise

  const changesText = `**Fields changed:**\n\n${changes.map(c => `- ${c}`).join('\n\n')}`;

  const card = buildCard({
    subtitle: `✏️ ${sourceLabel(source)}`,
    title: `Asset Updated: ${asset.vm_name || asset.hostname || asset.id}`,
    color: 'Default',
    facts: [
      { title: 'Asset Name',  value: asset.vm_name || asset.hostname },
      { title: 'IP Address',  value: asset.ip_address },
      { title: 'Inventory',   value: sourceLabel(source) },
      { title: 'Status',      value: asset.server_status },
      { title: 'Updated By',  value: updatedBy },
    ],
    changesText,
  });
  await send(card);
}

async function notifyDecommission(source, row, reason, decommissionedBy = null) {
  const cfg = await getConfig();
  if (!cfg.enabled || !cfg.notify_decommission || !cfg.webhook_url) return;

  const card = buildCard({
    subtitle: `🔴 ${sourceLabel(source)}`,
    title: `Decommissioned: ${row.vm_name || row.id}`,
    color: 'Attention',
    facts: [
      { title: 'Asset Name',        value: row.vm_name },
      { title: 'IP Address',        value: row.ip_address },
      { title: 'Inventory',         value: sourceLabel(source) },
      { title: 'OS Type',           value: row.os_type },
      { title: 'Location',          value: row.location },
      { title: 'Reason',            value: reason },
      { title: 'Decommissioned By', value: decommissionedBy },
    ],
  });
  await send(card);
}

async function notifyReactivation(source, assetName, ipAddress = null, reactivatedBy = null) {
  const cfg = await getConfig();
  if (!cfg.enabled || !cfg.notify_decommission || !cfg.webhook_url) return;

  const card = buildCard({
    subtitle: `🟢 ${sourceLabel(source)}`,
    title: `Asset Reactivated: ${assetName}`,
    color: 'Good',
    facts: [
      { title: 'Asset Name',    value: assetName },
      { title: 'IP Address',    value: ipAddress },
      { title: 'Inventory',     value: sourceLabel(source) },
      { title: 'Reactivated By', value: reactivatedBy },
    ],
  });
  await send(card);
}

async function notifyMigrationStatus(vmName, category, newStatus, updatedBy = null, ipAddress = null) {
  const cfg = await getConfig();
  if (!cfg.enabled || !cfg.notify_migration_status || !cfg.webhook_url) return;

  const card = buildCard({
    subtitle: '🔄 Migration Tracker',
    title: `Migration Status Changed: ${vmName}`,
    color: colorForStatus(newStatus),
    facts: [
      { title: 'VM / Host',  value: vmName },
      { title: 'IP Address', value: ipAddress },
      { title: 'Category',   value: category },
      { title: 'New Status', value: newStatus },
      { title: 'Updated By', value: updatedBy },
    ],
  });
  await send(card);
}

// Platform name (as passed by each scheduler) -> its own config toggle.
const HOST_DOWN_FLAG_FOR = {
  VMware:    'notify_host_down_vmware',
  Proxmox:   'notify_host_down_proxmox',
  'Hyper-V': 'notify_host_down_hyperv',
};

// Active-hours gate for connectivity alerts only (host-down/recovered, ping
// warning/critical/recovered) — every other alert type always sends.
// Outside the window the alert is dropped silently, not queued; the next
// check inside the window will re-alert if the problem is still real.
// Supports an overnight window (e.g. start 22:00, end 06:00).
function isWithinAlertWindow(cfg) {
  if (!cfg.alert_window_enabled) return true;
  const start = cfg.alert_window_start || '00:00';
  const end   = cfg.alert_window_end   || '23:59';
  const [sh, sm] = start.split(':').map(Number);
  const [eh, em] = end.split(':').map(Number);
  const startMins = sh * 60 + sm;
  const endMins   = eh * 60 + em;

  const now = new Date();
  const nowMins = now.getHours() * 60 + now.getMinutes();

  if (startMins <= endMins) return nowMins >= startMins && nowMins <= endMins;
  return nowMins >= startMins || nowMins <= endMins; // wraps past midnight
}

async function notifyHostDown(platform, host, errorMessage = null) {
  const cfg = await getConfig();
  const flag = HOST_DOWN_FLAG_FOR[platform];
  if (!cfg.enabled || !flag || !cfg[flag] || !cfg.webhook_url) return;
  if (!isWithinAlertWindow(cfg)) return;

  const card = buildCard({
    subtitle: `🔴 ${platform} Discovery`,
    title: `Host Unreachable: ${host}`,
    color: 'Attention',
    facts: [
      { title: 'Host',     value: host },
      { title: 'Platform', value: platform },
      { title: 'Error',    value: errorMessage },
    ],
  });
  await send(card);
}

async function notifyHostRecovered(platform, host) {
  const cfg = await getConfig();
  const flag = HOST_DOWN_FLAG_FOR[platform];
  if (!cfg.enabled || !flag || !cfg[flag] || !cfg.webhook_url) return;
  if (!isWithinAlertWindow(cfg)) return;

  const card = buildCard({
    subtitle: `🟢 ${platform} Discovery`,
    title: `Host Connectivity Restored: ${host}`,
    color: 'Good',
    facts: [
      { title: 'Host',     value: host },
      { title: 'Platform', value: platform },
    ],
  });
  await send(card);
}

// ── Ping-based connectivity alerts — driven by pingMonitorService's scheduled
// ICMP checks, independent of discovery-run success/failure. First
// consecutive failure is a Warning; every failure after that is Critical
// (re-alerts on every check while still down, by design).

async function notifyPingWarning(platform, host) {
  const cfg = await getConfig();
  const flag = HOST_DOWN_FLAG_FOR[platform];
  if (!cfg.enabled || !flag || !cfg[flag] || !cfg.webhook_url) return;
  if (!isWithinAlertWindow(cfg)) return;

  const card = buildCard({
    subtitle: `🟡 ${platform} Ping Monitor`,
    title: `Warning: ${host} is not responding to ping`,
    color: 'Warning',
    facts: [
      { title: 'Host',                  value: host },
      { title: 'Platform',              value: platform },
      { title: 'Consecutive Failures',  value: '1' },
    ],
  });
  await send(card);
}

async function notifyPingCritical(platform, host, failCount) {
  const cfg = await getConfig();
  const flag = HOST_DOWN_FLAG_FOR[platform];
  if (!cfg.enabled || !flag || !cfg[flag] || !cfg.webhook_url) return;
  if (!isWithinAlertWindow(cfg)) return;

  const card = buildCard({
    subtitle: `🔴 ${platform} Ping Monitor`,
    title: `Critical: ${host} is unreachable`,
    color: 'Attention',
    facts: [
      { title: 'Host',                  value: host },
      { title: 'Platform',              value: platform },
      { title: 'Consecutive Failures',  value: String(failCount) },
    ],
  });
  await send(card);
}

async function notifyPingRecovered(platform, host) {
  const cfg = await getConfig();
  const flag = HOST_DOWN_FLAG_FOR[platform];
  if (!cfg.enabled || !flag || !cfg[flag] || !cfg.webhook_url) return;
  if (!isWithinAlertWindow(cfg)) return;

  const card = buildCard({
    subtitle: `🟢 ${platform} Ping Monitor`,
    title: `Recovered: ${host} is responding to ping again`,
    color: 'Good',
    facts: [
      { title: 'Host',     value: host },
      { title: 'Platform', value: platform },
    ],
  });
  await send(card);
}

async function testNotification(overrideUrl) {
  const cfg = await getConfig();
  const webhookUrl = overrideUrl || cfg.webhook_url;
  if (!webhookUrl) throw new Error('No webhook URL configured');

  const card = buildCard({
    subtitle: 'NetBrain Inventory Tool',
    title: 'Teams notification test successful!',
    color: 'Good',
    facts: [
      { title: 'Status', value: 'Connected' },
      { title: 'Time',   value: new Date().toISOString() },
    ],
  });
  await postJson(webhookUrl, card);
}

module.exports = {
  getConfig,
  saveConfig,
  notifyNewAsset,
  notifyAssetUpdate,
  notifyDecommission,
  notifyReactivation,
  notifyMigrationStatus,
  notifyHostDown,
  notifyHostRecovered,
  notifyPingWarning,
  notifyPingCritical,
  notifyPingRecovered,
  testNotification,
};
