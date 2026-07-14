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
};

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
    notify_migration_status = cfg.notify_migration_status,
  } = fields;

  await db.query(
    `INSERT INTO teams_notification_config
        (webhook_url, enabled, notify_new_asset, notify_asset_update,
         notify_decommission, notify_migration_status, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,NOW())
     ON CONFLICT (singleton) DO UPDATE SET
        webhook_url             = EXCLUDED.webhook_url,
        enabled                 = EXCLUDED.enabled,
        notify_new_asset        = EXCLUDED.notify_new_asset,
        notify_asset_update     = EXCLUDED.notify_asset_update,
        notify_decommission     = EXCLUDED.notify_decommission,
        notify_migration_status = EXCLUDED.notify_migration_status,
        updated_at              = NOW()`,
    [webhook_url, enabled, notify_new_asset, notify_asset_update,
     notify_decommission, notify_migration_status],
  );
  return getConfig();
}

// ── Adaptive Card helpers ─────────────────────────────────────────────────────

function colorForStatus(status) {
  const s = String(status || '').toLowerCase();
  if (s === 'completed' || s === 'migrated') return 'Good';
  if (s === 'blocked'   || s.includes('decom'))   return 'Attention';
  if (s === 'in progress') return 'Accent';
  return 'Default';
}

function buildCard({ title, color = 'Default', facts = [], subtitle = null }) {
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

// ── Public notify* functions ──────────────────────────────────────────────────

async function notifyNewAsset(asset, source = 'assets') {
  const cfg = await getConfig();
  if (!cfg.enabled || !cfg.notify_new_asset || !cfg.webhook_url) return;

  const sourceLabel = {
    assets: 'Asset Inventory',
    beijing_assets: 'Beijing Assets',
    ext_assets: 'Ext. Assets',
    physical_esxi_servers: 'Physical / ESXi',
  }[source] || source;

  const card = buildCard({
    subtitle: sourceLabel,
    title: `New Asset Registered: ${asset.vm_name || asset.hostname || asset.id}`,
    color: 'Accent',
    facts: [
      { title: 'IP Address',  value: asset.ip_address },
      { title: 'OS Type',     value: asset.os_type },
      { title: 'Location',    value: asset.location },
      { title: 'Department',  value: asset.department },
      { title: 'Asset Tag',   value: asset.asset_tag },
    ],
  });
  await send(card);
}

async function notifyAssetUpdate(asset, source = 'assets') {
  const cfg = await getConfig();
  if (!cfg.enabled || !cfg.notify_asset_update || !cfg.webhook_url) return;

  const sourceLabel = {
    assets: 'Asset Inventory',
    beijing_assets: 'Beijing Assets',
    ext_assets: 'Ext. Assets',
    physical_esxi_servers: 'Physical / ESXi',
  }[source] || source;

  const card = buildCard({
    subtitle: sourceLabel,
    title: `Asset Updated: ${asset.vm_name || asset.hostname || asset.id}`,
    color: 'Default',
    facts: [
      { title: 'IP Address',  value: asset.ip_address },
      { title: 'Status',      value: asset.server_status },
      { title: 'OS Type',     value: asset.os_type },
      { title: 'Location',    value: asset.location },
      { title: 'Department',  value: asset.department },
    ],
  });
  await send(card);
}

async function notifyDecommission(source, row, reason) {
  const cfg = await getConfig();
  if (!cfg.enabled || !cfg.notify_decommission || !cfg.webhook_url) return;

  const card = buildCard({
    subtitle: 'Decommission Event',
    title: `Decommissioned: ${row.vm_name || row.id}`,
    color: 'Attention',
    facts: [
      { title: 'IP Address', value: row.ip_address },
      { title: 'Location',   value: row.location },
      { title: 'OS Type',    value: row.os_type },
      { title: 'Reason',     value: reason },
      { title: 'Source',     value: source },
    ],
  });
  await send(card);
}

async function notifyReactivation(source, assetId, assetName) {
  const cfg = await getConfig();
  if (!cfg.enabled || !cfg.notify_decommission || !cfg.webhook_url) return;

  const card = buildCard({
    subtitle: 'Reactivation Event',
    title: `Asset Reactivated: ${assetName || `#${assetId}`}`,
    color: 'Good',
    facts: [
      { title: 'Source', value: source },
      { title: 'ID',     value: String(assetId) },
    ],
  });
  await send(card);
}

async function notifyMigrationStatus(vmName, category, newStatus) {
  const cfg = await getConfig();
  if (!cfg.enabled || !cfg.notify_migration_status || !cfg.webhook_url) return;

  const card = buildCard({
    subtitle: 'Migration Tracker',
    title: `Migration Status Changed: ${vmName}`,
    color: colorForStatus(newStatus),
    facts: [
      { title: 'VM / Host', value: vmName },
      { title: 'Category',  value: category },
      { title: 'New Status', value: newStatus },
    ],
  });
  await send(card);
}

async function testNotification() {
  const cfg = await getConfig();
  if (!cfg.webhook_url) throw new Error('No webhook URL configured');

  const card = buildCard({
    subtitle: 'NetBrain Inventory Tool',
    title: 'Teams notification test successful!',
    color: 'Good',
    facts: [
      { title: 'Status', value: 'Connected' },
      { title: 'Time',   value: new Date().toISOString() },
    ],
  });
  await postJson(cfg.webhook_url, card);
}

module.exports = {
  getConfig,
  saveConfig,
  notifyNewAsset,
  notifyAssetUpdate,
  notifyDecommission,
  notifyReactivation,
  notifyMigrationStatus,
  testNotification,
};
