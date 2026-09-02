/**
 * ensureSchema.js
 * ----------------
 * Idempotent DDL executed at server startup so recently added tables and
 * columns exist even when a deployment forgot to run the SQL migrations
 * under db/migrations/. Every statement is IF NOT EXISTS / IF EXISTS, so
 * running repeatedly is safe and fast.
 */
const db = require('../config/db');

const STATEMENTS = [
  // ── roles / per-user page control (add_custom_roles_and_page_control.sql)
  `ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check`,
  `ALTER TABLE users ALTER COLUMN role TYPE VARCHAR(64)`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS can_view_passwords BOOLEAN NOT NULL DEFAULT FALSE`,
  `CREATE TABLE IF NOT EXISTS custom_roles (
      id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name        VARCHAR(64) UNIQUE NOT NULL,
      label       VARCHAR(128) NOT NULL,
      description TEXT,
      created_by  UUID REFERENCES users(id) ON DELETE SET NULL,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
   )`,
  `CREATE INDEX IF NOT EXISTS idx_custom_roles_name ON custom_roles(name)`,
  `CREATE TABLE IF NOT EXISTS system_role_overrides (
      name        VARCHAR(64) PRIMARY KEY,
      label       VARCHAR(128) NOT NULL,
      description TEXT,
      updated_by  UUID REFERENCES users(id) ON DELETE SET NULL,
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
   )`,
  `CREATE TABLE IF NOT EXISTS user_page_access (
      user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      page_key    VARCHAR(128) NOT NULL,
      allowed     BOOLEAN NOT NULL DEFAULT TRUE,
      updated_by  UUID REFERENCES users(id) ON DELETE SET NULL,
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (user_id, page_key)
   )`,
  `CREATE INDEX IF NOT EXISTS idx_user_page_access_user ON user_page_access(user_id)`,
  `ALTER TABLE page_access ALTER COLUMN role TYPE VARCHAR(64)`,

  // ── Proxmox discovery: MAC addresses (proxmox_schema.sql predates this column)
  `ALTER TABLE proxmox_discovered_vms ADD COLUMN IF NOT EXISTS macs TEXT[]`,

  // ── Proxmox / Hyper-V discovery: guest OS hostname (VMware already had this;
  // Proxmox/Hyper-V predate collecting it, so the Hostname column was blank).
  `ALTER TABLE proxmox_discovered_vms ADD COLUMN IF NOT EXISTS hostname VARCHAR(255)`,
  `ALTER TABLE hyperv_discovered_vms  ADD COLUMN IF NOT EXISTS hostname VARCHAR(255)`,

  // ── VMware / Proxmox discovery: current failure state on the host row.
  // Same gap as Hyper-V below — last_discovery_at/last_vm_count are only
  // ever set on SUCCESS, so a host that fails every run (bad password,
  // unreachable, etc.) looks identical to one that's never run. These
  // columns back the dashboard alert bell.
  `ALTER TABLE vmware_hosts ADD COLUMN IF NOT EXISTS last_status VARCHAR(20)`,
  `ALTER TABLE vmware_hosts ADD COLUMN IF NOT EXISTS last_error  TEXT`,
  `ALTER TABLE vmware_hosts ADD COLUMN IF NOT EXISTS last_attempt_at TIMESTAMPTZ`,
  `ALTER TABLE proxmox_hosts ADD COLUMN IF NOT EXISTS last_status VARCHAR(20)`,
  `ALTER TABLE proxmox_hosts ADD COLUMN IF NOT EXISTS last_error  TEXT`,
  `ALTER TABLE proxmox_hosts ADD COLUMN IF NOT EXISTS last_attempt_at TIMESTAMPTZ`,

  // Consecutive discovery-run failure counter — 1st failure alerts as
  // Warning, 2nd and every one after that alerts as Critical, reset to 0
  // on the next successful run. Mirrors ping_fail_count's tiering.
  // (hyperv_hosts's own copy of this column lives further down, right after
  // that table's CREATE TABLE — this file's hyperv_hosts is created by
  // ensureSchema itself, unlike vmware_hosts/proxmox_hosts which are
  // pre-existing tables from the manually-applied db/*_schema.sql files, so
  // an ALTER on it up here would run before the table exists yet.)
  `ALTER TABLE vmware_hosts  ADD COLUMN IF NOT EXISTS discovery_fail_count INT NOT NULL DEFAULT 0`,
  `ALTER TABLE proxmox_hosts ADD COLUMN IF NOT EXISTS discovery_fail_count INT NOT NULL DEFAULT 0`,

  // ── Ping-based connectivity monitoring (independent of discovery runs) —
  // a scheduled ICMP ping per host, tracked separately so Warning/Critical
  // Teams alerts can fire on 1st/2nd+ consecutive ping failure without
  // waiting on (or being tied to) the much slower discovery poll cycle.
  // (hyperv_hosts's copy lives further down for the same reason as above.)
  `ALTER TABLE vmware_hosts  ADD COLUMN IF NOT EXISTS ping_status VARCHAR(10)`,
  `ALTER TABLE vmware_hosts  ADD COLUMN IF NOT EXISTS ping_fail_count INT NOT NULL DEFAULT 0`,
  `ALTER TABLE vmware_hosts  ADD COLUMN IF NOT EXISTS ping_last_checked_at TIMESTAMPTZ`,
  `ALTER TABLE proxmox_hosts ADD COLUMN IF NOT EXISTS ping_status VARCHAR(10)`,
  `ALTER TABLE proxmox_hosts ADD COLUMN IF NOT EXISTS ping_fail_count INT NOT NULL DEFAULT 0`,
  `ALTER TABLE proxmox_hosts ADD COLUMN IF NOT EXISTS ping_last_checked_at TIMESTAMPTZ`,

  // Alert history for the ping-monitor above — a durable, queryable log of
  // every Warning/Critical transition (recoveries aren't alerts, so they
  // aren't logged here), independent of whether Teams notifications are
  // configured. Backs the Connectivity Alerts page's "by date" / "by
  // platform" cards.
  `CREATE TABLE IF NOT EXISTS host_connectivity_alerts (
      id          SERIAL PRIMARY KEY,
      platform    VARCHAR(20) NOT NULL,
      host_id     INT NOT NULL,
      host        VARCHAR(255) NOT NULL,
      severity    VARCHAR(10) NOT NULL,
      ping_ok     BOOLEAN NOT NULL,
      ssh_ok      BOOLEAN,
      fail_count  INT NOT NULL,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
   )`,
  // Added after the table's initial release — whether the deciding check
  // (SSH once consulted, otherwise ping) failed via a real timeout (no
  // response at all) rather than an active rejection (auth failure,
  // connection refused, "host unreachable", etc). Backs the "Timed Out
  // Reaching" card.
  `ALTER TABLE host_connectivity_alerts ADD COLUMN IF NOT EXISTS timed_out BOOLEAN NOT NULL DEFAULT FALSE`,
  // Which subsystem raised this row — the ping-monitor's own ICMP/SSH dual
  // check ('ping_monitor'), or a discovery run that couldn't even reach the
  // host's management API ('discovery', logged by hostAlertsService.
  // logDiscoveryFailure(), called from each scheduler's failure branch).
  // Both are genuine connectivity failures, just at different layers, so
  // they're counted together on the Connectivity Alerts page.
  `ALTER TABLE host_connectivity_alerts ADD COLUMN IF NOT EXISTS source VARCHAR(20) NOT NULL DEFAULT 'ping_monitor'`,
  `CREATE INDEX IF NOT EXISTS idx_host_conn_alerts_created_at ON host_connectivity_alerts(created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_host_conn_alerts_platform   ON host_connectivity_alerts(platform)`,

  // High CPU/Memory utilization monitor — admin-set thresholds (config) and
  // a durable log of every discovery tick that found a host over either one
  // (checkAndLog* in hostUtilizationService.js, called from each platform's
  // scheduler right after it saves fresh telemetry). Backs the "High
  // Utilization" card on the Connectivity Alerts page.
  `CREATE TABLE IF NOT EXISTS utilization_monitor_config (
      id                    SERIAL PRIMARY KEY,
      singleton             BOOLEAN NOT NULL DEFAULT TRUE UNIQUE,
      enabled               BOOLEAN NOT NULL DEFAULT TRUE,
      cpu_threshold_pct     NUMERIC(5,1) NOT NULL DEFAULT 85,
      memory_threshold_pct  NUMERIC(5,1) NOT NULL DEFAULT 85,
      updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
   )`,
  // Added after the table's initial release, alongside CPU/Memory.
  `ALTER TABLE utilization_monitor_config ADD COLUMN IF NOT EXISTS disk_threshold_pct NUMERIC(5,1) NOT NULL DEFAULT 85`,
  `CREATE TABLE IF NOT EXISTS host_utilization_alerts (
      id           SERIAL PRIMARY KEY,
      platform     VARCHAR(20) NOT NULL,
      host_id      INT NOT NULL,
      host         VARCHAR(255) NOT NULL,
      ip_address   VARCHAR(64),
      cpu_pct      NUMERIC(5,1),
      memory_pct   NUMERIC(5,1),
      cpu_over     BOOLEAN NOT NULL DEFAULT FALSE,
      memory_over  BOOLEAN NOT NULL DEFAULT FALSE,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
   )`,
  `ALTER TABLE host_utilization_alerts ADD COLUMN IF NOT EXISTS disk_pct  NUMERIC(5,1)`,
  `ALTER TABLE host_utilization_alerts ADD COLUMN IF NOT EXISTS disk_over BOOLEAN NOT NULL DEFAULT FALSE`,
  `CREATE INDEX IF NOT EXISTS idx_host_util_alerts_created_at ON host_utilization_alerts(created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_host_util_alerts_platform   ON host_utilization_alerts(platform)`,

  `CREATE TABLE IF NOT EXISTS ping_monitor_config (
      id                       SERIAL PRIMARY KEY,
      singleton                BOOLEAN NOT NULL DEFAULT TRUE UNIQUE,
      vmware_enabled           BOOLEAN NOT NULL DEFAULT TRUE,
      vmware_interval_minutes  INT     NOT NULL DEFAULT 5,
      vmware_window_start      VARCHAR(5) NOT NULL DEFAULT '00:00',
      vmware_window_end        VARCHAR(5) NOT NULL DEFAULT '23:59',
      proxmox_enabled          BOOLEAN NOT NULL DEFAULT TRUE,
      proxmox_interval_minutes INT     NOT NULL DEFAULT 5,
      proxmox_window_start     VARCHAR(5) NOT NULL DEFAULT '00:00',
      proxmox_window_end       VARCHAR(5) NOT NULL DEFAULT '23:59',
      hyperv_enabled           BOOLEAN NOT NULL DEFAULT TRUE,
      hyperv_interval_minutes  INT     NOT NULL DEFAULT 5,
      hyperv_window_start      VARCHAR(5) NOT NULL DEFAULT '00:00',
      hyperv_window_end        VARCHAR(5) NOT NULL DEFAULT '23:59',
      vmware_active_days       INTEGER[] NOT NULL DEFAULT ARRAY[0,1,2,3,4,5,6],
      proxmox_active_days      INTEGER[] NOT NULL DEFAULT ARRAY[0,1,2,3,4,5,6],
      hyperv_active_days       INTEGER[] NOT NULL DEFAULT ARRAY[0,1,2,3,4,5,6],
      updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
   )`,
  // Minute interval + Start/End active window superseded the original
  // day+time-of-day schedule — added via ALTER for installs where the
  // table above already existed with only the old *_interval_days /
  // *_check_time columns.
  `ALTER TABLE ping_monitor_config ADD COLUMN IF NOT EXISTS vmware_interval_minutes  INT NOT NULL DEFAULT 5`,
  `ALTER TABLE ping_monitor_config ADD COLUMN IF NOT EXISTS vmware_window_start      VARCHAR(5) NOT NULL DEFAULT '00:00'`,
  `ALTER TABLE ping_monitor_config ADD COLUMN IF NOT EXISTS vmware_window_end        VARCHAR(5) NOT NULL DEFAULT '23:59'`,
  `ALTER TABLE ping_monitor_config ADD COLUMN IF NOT EXISTS proxmox_interval_minutes INT NOT NULL DEFAULT 5`,
  `ALTER TABLE ping_monitor_config ADD COLUMN IF NOT EXISTS proxmox_window_start     VARCHAR(5) NOT NULL DEFAULT '00:00'`,
  `ALTER TABLE ping_monitor_config ADD COLUMN IF NOT EXISTS proxmox_window_end       VARCHAR(5) NOT NULL DEFAULT '23:59'`,
  `ALTER TABLE ping_monitor_config ADD COLUMN IF NOT EXISTS hyperv_interval_minutes  INT NOT NULL DEFAULT 5`,
  `ALTER TABLE ping_monitor_config ADD COLUMN IF NOT EXISTS hyperv_window_start      VARCHAR(5) NOT NULL DEFAULT '00:00'`,
  `ALTER TABLE ping_monitor_config ADD COLUMN IF NOT EXISTS hyperv_window_end        VARCHAR(5) NOT NULL DEFAULT '23:59'`,
  // Day-of-week gate per platform (0=Sunday..6=Saturday) — a check tick is
  // skipped entirely on a day left unchecked here, same as being outside
  // the time window above.
  `ALTER TABLE ping_monitor_config ADD COLUMN IF NOT EXISTS vmware_active_days  INTEGER[] NOT NULL DEFAULT ARRAY[0,1,2,3,4,5,6]`,
  `ALTER TABLE ping_monitor_config ADD COLUMN IF NOT EXISTS proxmox_active_days INTEGER[] NOT NULL DEFAULT ARRAY[0,1,2,3,4,5,6]`,
  `ALTER TABLE ping_monitor_config ADD COLUMN IF NOT EXISTS hyperv_active_days  INTEGER[] NOT NULL DEFAULT ARRAY[0,1,2,3,4,5,6]`,

  // ── VMware discovery: ESXi host hardware telemetry (CPU/RAM/disk/uptime),
  // fetched via vim25 SOAP alongside each discovery run — powers the extra
  // columns on the Hosts & Credentials tab.
  `ALTER TABLE vmware_hosts ADD COLUMN IF NOT EXISTS hardware_model    VARCHAR(255)`,
  `ALTER TABLE vmware_hosts ADD COLUMN IF NOT EXISTS cpu_cores         INT`,
  `ALTER TABLE vmware_hosts ADD COLUMN IF NOT EXISTS cpu_usage_pct     NUMERIC(5,1)`,
  `ALTER TABLE vmware_hosts ADD COLUMN IF NOT EXISTS memory_total_mb   INT`,
  `ALTER TABLE vmware_hosts ADD COLUMN IF NOT EXISTS memory_used_mb    INT`,
  `ALTER TABLE vmware_hosts ADD COLUMN IF NOT EXISTS disk_total_gb     NUMERIC(10,1)`,
  `ALTER TABLE vmware_hosts ADD COLUMN IF NOT EXISTS disk_used_gb      NUMERIC(10,1)`,
  `ALTER TABLE vmware_hosts ADD COLUMN IF NOT EXISTS uptime_seconds    BIGINT`,

  // A vmware_hosts row can be a vCenter managing many physical ESXi hosts
  // with different hardware — the columns above only make sense for a
  // standalone-ESXi row (exactly one host). This table holds one row per
  // ESXi host actually under management, for the per-host breakdown in the
  // "Hosts & Credentials" expandable row.
  `CREATE TABLE IF NOT EXISTS vmware_esxi_host_stats (
      host_id         UUID NOT NULL REFERENCES vmware_hosts(id) ON DELETE CASCADE,
      esxi_name       VARCHAR(255) NOT NULL,
      esxi_ip         VARCHAR(255),
      hardware_model  VARCHAR(255),
      cpu_cores       INT,
      cpu_usage_pct   NUMERIC(5,1),
      memory_total_mb INT,
      memory_used_mb  INT,
      disk_total_gb   NUMERIC(10,1),
      disk_used_gb    NUMERIC(10,1),
      uptime_seconds  BIGINT,
      updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (host_id, esxi_name)
   )`,

  // ── Proxmox discovery: physical/cluster node inventory (proxmox_schema.sql predates this table)
  `CREATE TABLE IF NOT EXISTS proxmox_discovered_nodes (
      id              SERIAL PRIMARY KEY,
      run_id          INTEGER      NOT NULL REFERENCES proxmox_discovery_runs(id) ON DELETE CASCADE,
      host_id         INTEGER      NOT NULL REFERENCES proxmox_hosts(id) ON DELETE CASCADE,
      source_host     VARCHAR(255),
      node            VARCHAR(255),
      status          VARCHAR(50),
      ip_address      VARCHAR(64),
      mac_address     VARCHAR(64),
      os_type         VARCHAR(100),
      os_version      VARCHAR(255),
      kernel_version  VARCHAR(255),
      cpu_model       VARCHAR(255),
      cpu_cores       INTEGER,
      cpu_sockets     INTEGER,
      memory_mb       INTEGER,
      uptime_seconds  BIGINT,
      vm_count        INTEGER      DEFAULT 0,
      snapshot_count  INTEGER      DEFAULT 0,
      created_at      TIMESTAMP    NOT NULL DEFAULT NOW()
   )`,
  `CREATE INDEX IF NOT EXISTS idx_proxmox_nodes_run_id  ON proxmox_discovered_nodes(run_id)`,
  `CREATE INDEX IF NOT EXISTS idx_proxmox_nodes_host_id ON proxmox_discovered_nodes(host_id)`,
  `CREATE INDEX IF NOT EXISTS idx_proxmox_nodes_node    ON proxmox_discovered_nodes(node)`,

  // ── Proxmox discovery: node CPU/RAM/disk usage (capacity-only columns
  // above predate this) — powers the same Hosts & Credentials hardware
  // display added for VMware.
  `ALTER TABLE proxmox_discovered_nodes ADD COLUMN IF NOT EXISTS cpu_usage_pct  NUMERIC(5,1)`,
  `ALTER TABLE proxmox_discovered_nodes ADD COLUMN IF NOT EXISTS memory_used_mb INT`,
  `ALTER TABLE proxmox_discovered_nodes ADD COLUMN IF NOT EXISTS disk_total_gb  NUMERIC(10,1)`,
  `ALTER TABLE proxmox_discovered_nodes ADD COLUMN IF NOT EXISTS disk_used_gb   NUMERIC(10,1)`,

  // ── newer inventory columns some deployments predate (schema.sql ALTERs)
  ...['assets', 'beijing_assets', 'ext_assets', 'physical_esxi_servers'].flatMap(t => [
    `ALTER TABLE ${t} ADD COLUMN IF NOT EXISTS extras JSONB NOT NULL DEFAULT '{}'::jsonb`,
    `ALTER TABLE ${t} ADD COLUMN IF NOT EXISTS idrac_ip VARCHAR(64)`,
    `ALTER TABLE ${t} ADD COLUMN IF NOT EXISTS mac_address VARCHAR(255)`,
    `ALTER TABLE ${t} ADD COLUMN IF NOT EXISTS idrac_enabled BOOLEAN NOT NULL DEFAULT FALSE`,
    `ALTER TABLE ${t} ADD COLUMN IF NOT EXISTS asset_password_encrypted TEXT`,
    `ALTER TABLE ${t} ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ`,
    `ALTER TABLE ${t} ADD COLUMN IF NOT EXISTS deleted_by UUID REFERENCES users(id) ON DELETE SET NULL`,
  ]),

  // ── decommission lifecycle (add_decommission.sql)
  ...['assets', 'beijing_assets', 'ext_assets', 'physical_esxi_servers'].flatMap(t => [
    `ALTER TABLE ${t} ADD COLUMN IF NOT EXISTS decommissioned_at TIMESTAMPTZ`,
    `ALTER TABLE ${t} ADD COLUMN IF NOT EXISTS decommissioned_by UUID REFERENCES users(id) ON DELETE SET NULL`,
  ]),
  `CREATE TABLE IF NOT EXISTS decommission_log (
      id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      source                VARCHAR(64)  NOT NULL,
      asset_id              UUID         NOT NULL,
      vm_name               VARCHAR(255),
      os_hostname           VARCHAR(255),
      ip_address            VARCHAR(64),
      asset_tag             VARCHAR(128),
      serial_number         VARCHAR(128),
      os_type               VARCHAR(128),
      location              VARCHAR(128),
      hosted_ip             VARCHAR(64),
      reason                TEXT,
      decommissioned_by     UUID REFERENCES users(id) ON DELETE SET NULL,
      decommissioned_by_name VARCHAR(255),
      decommissioned_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      reactivated_by        UUID REFERENCES users(id) ON DELETE SET NULL,
      reactivated_by_name   VARCHAR(255),
      reactivated_at        TIMESTAMPTZ
   )`,
  `CREATE INDEX IF NOT EXISTS idx_decommission_log_asset ON decommission_log(source, asset_id)`,
  `CREATE INDEX IF NOT EXISTS idx_decommission_log_at    ON decommission_log(decommissioned_at DESC)`,
  // Decommissioned rows release their IP/tag for reuse by active records.
  `DROP INDEX IF EXISTS uq_assets_ip_active`,
  `CREATE UNIQUE INDEX IF NOT EXISTS uq_assets_ip_active ON assets(ip_address) WHERE deleted_at IS NULL AND decommissioned_at IS NULL`,
  `DROP INDEX IF EXISTS uq_assets_tag_active`,
  `CREATE UNIQUE INDEX IF NOT EXISTS uq_assets_tag_active ON assets(asset_tag) WHERE deleted_at IS NULL AND decommissioned_at IS NULL AND asset_tag IS NOT NULL`,
  `DROP INDEX IF EXISTS uq_beijing_ip_active`,
  `CREATE UNIQUE INDEX IF NOT EXISTS uq_beijing_ip_active ON beijing_assets(ip_address) WHERE deleted_at IS NULL AND decommissioned_at IS NULL`,
  `DROP INDEX IF EXISTS uq_beijing_tag_active`,
  `CREATE UNIQUE INDEX IF NOT EXISTS uq_beijing_tag_active ON beijing_assets(asset_tag) WHERE deleted_at IS NULL AND decommissioned_at IS NULL AND asset_tag IS NOT NULL`,
  `DROP INDEX IF EXISTS uq_ext_ip_active`,
  `CREATE UNIQUE INDEX IF NOT EXISTS uq_ext_ip_active ON ext_assets(ip_address) WHERE deleted_at IS NULL AND decommissioned_at IS NULL`,
  `DROP INDEX IF EXISTS uq_ext_tag_active`,
  `CREATE UNIQUE INDEX IF NOT EXISTS uq_ext_tag_active ON ext_assets(asset_tag) WHERE deleted_at IS NULL AND decommissioned_at IS NULL AND asset_tag IS NOT NULL`,
  `DROP INDEX IF EXISTS uq_physical_ip_active`,
  `CREATE UNIQUE INDEX IF NOT EXISTS uq_physical_ip_active ON physical_esxi_servers(ip_address) WHERE deleted_at IS NULL AND decommissioned_at IS NULL`,
  `DROP INDEX IF EXISTS uq_physical_tag_active`,
  `CREATE UNIQUE INDEX IF NOT EXISTS uq_physical_tag_active ON physical_esxi_servers(asset_tag) WHERE deleted_at IS NULL AND decommissioned_at IS NULL AND asset_tag IS NOT NULL`,

  // ── dashboard customization (org-wide, JSONB so new widgets need no DDL)
  `CREATE TABLE IF NOT EXISTS dashboard_config (
      id          INTEGER PRIMARY KEY DEFAULT 1,
      config      JSONB NOT NULL DEFAULT '{}'::jsonb,
      updated_by  UUID REFERENCES users(id) ON DELETE SET NULL,
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
   )`,
  `INSERT INTO dashboard_config (id) VALUES (1) ON CONFLICT (id) DO NOTHING`,

  // ── compliance rule config (admin-editable filters for MSL / Ext queries)
  `CREATE TABLE IF NOT EXISTS compliance_config (
      id          INTEGER PRIMARY KEY DEFAULT 1,
      config      JSONB NOT NULL DEFAULT '{}'::jsonb,
      updated_by  UUID REFERENCES users(id) ON DELETE SET NULL,
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
   )`,
  `INSERT INTO compliance_config (id) VALUES (1) ON CONFLICT (id) DO NOTHING`,

  // ── recurring activity rotation config (Ready Reckoner — admin-editable)
  `CREATE TABLE IF NOT EXISTS recurring_activity_config (
      id          INTEGER PRIMARY KEY DEFAULT 1,
      config      JSONB NOT NULL DEFAULT '{}'::jsonb,
      updated_by  UUID REFERENCES users(id) ON DELETE SET NULL,
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
   )`,
  `INSERT INTO recurring_activity_config (id) VALUES (1) ON CONFLICT (id) DO NOTHING`,

  // ── recurring activity manual overrides (leave, handover) — take priority
  // over the automatic rotation for one specific period + activity
  `CREATE TABLE IF NOT EXISTS recurring_activity_overrides (
      id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      frequency     VARCHAR(10) NOT NULL CHECK (frequency IN ('monthly','weekly')),
      period_key    VARCHAR(20) NOT NULL,   -- '2026-08' or '2026-08-03' (Monday)
      activity_key  VARCHAR(64) NOT NULL,
      assigned_to   VARCHAR(120) NOT NULL,
      reason        TEXT,
      created_by    UUID REFERENCES users(id) ON DELETE SET NULL,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (frequency, period_key, activity_key)
   )`,

  // ── recurring activity progress tracking (status + planned/completed
  // dates) — one row per period + activity, updatable by the currently
  // assigned person or an admin (assignment itself is admin-only, via
  // recurring_activity_overrides above)
  `CREATE TABLE IF NOT EXISTS recurring_activity_status (
      id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      frequency      VARCHAR(10) NOT NULL CHECK (frequency IN ('monthly','weekly')),
      period_key     VARCHAR(20) NOT NULL,
      activity_key   VARCHAR(64) NOT NULL,
      status         VARCHAR(20) NOT NULL DEFAULT 'not_started'
                        CHECK (status IN ('not_started','in_progress','completed')),
      planned_date   DATE,
      completed_date DATE,
      updated_by     UUID REFERENCES users(id) ON DELETE SET NULL,
      updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (frequency, period_key, activity_key)
   )`,

  // ── ManageEngine Endpoint Central connection config (singleton row)
  // NOTE: api_key and auth_password store AES-256-GCM ciphertext (see
  // utils/crypto.js), written/read via endpointCentralService.js — never
  // plaintext, mirroring asset_password_encrypted elsewhere in the app.
  `CREATE TABLE IF NOT EXISTS endpoint_central_config (
      id          INTEGER PRIMARY KEY DEFAULT 1,
      server_url  TEXT NOT NULL DEFAULT '',
      customer_id TEXT NOT NULL DEFAULT '1',
      api_key     TEXT NOT NULL DEFAULT '',
      api_path    TEXT NOT NULL DEFAULT '',
      verify_ssl  BOOLEAN NOT NULL DEFAULT FALSE,
      updated_by  UUID REFERENCES users(id) ON DELETE SET NULL,
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
   )`,
  `INSERT INTO endpoint_central_config (id) VALUES (1) ON CONFLICT (id) DO NOTHING`,
  `ALTER TABLE endpoint_central_config ADD COLUMN IF NOT EXISTS api_path      TEXT    NOT NULL DEFAULT ''`,
  `ALTER TABLE endpoint_central_config ADD COLUMN IF NOT EXISTS auth_mode     VARCHAR(16) NOT NULL DEFAULT 'api_key'`,
  `ALTER TABLE endpoint_central_config ADD COLUMN IF NOT EXISTS auth_username TEXT    NOT NULL DEFAULT ''`,
  `ALTER TABLE endpoint_central_config ADD COLUMN IF NOT EXISTS auth_password TEXT    NOT NULL DEFAULT ''`,
  `ALTER TABLE endpoint_central_config ADD COLUMN IF NOT EXISTS session_token TEXT    NOT NULL DEFAULT ''`,

  // ── vm_name uniqueness removal (drop_vm_name_unique.sql)
  `ALTER TABLE assets                DROP CONSTRAINT IF EXISTS assets_vm_name_key`,
  `ALTER TABLE beijing_assets        DROP CONSTRAINT IF EXISTS beijing_assets_vm_name_key`,
  `ALTER TABLE ext_assets            DROP CONSTRAINT IF EXISTS ext_assets_vm_name_key`,
  `ALTER TABLE physical_esxi_servers DROP CONSTRAINT IF EXISTS physical_esxi_servers_vm_name_key`,
  `DROP INDEX IF EXISTS uq_assets_vm_active`,
  `DROP INDEX IF EXISTS uq_beijing_vm_active`,
  `DROP INDEX IF EXISTS uq_ext_vm_active`,
  `DROP INDEX IF EXISTS uq_physical_vm_active`,

  // ── ME / Nessus install configs (add_install_config_tables.sql)
  `CREATE TABLE IF NOT EXISTS software_install_config (
      id                     INTEGER PRIMARY KEY DEFAULT 1,
      linux_file_path        TEXT,
      linux_serverinfo_path  TEXT,
      linux_cmd              TEXT,
      windows_method         VARCHAR(16) DEFAULT 'ssh',
      windows_file_path      TEXT,
      windows_cmd            TEXT,
      windows_psexec_path    TEXT,
      windows_winrm_port     INTEGER DEFAULT 5985,
      windows_smb_port       INTEGER DEFAULT 445,
      skip_if_installed      BOOLEAN DEFAULT FALSE,
      log_file_path          TEXT,
      updated_by             UUID REFERENCES users(id) ON DELETE SET NULL,
      updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
   )`,
  `INSERT INTO software_install_config (id) VALUES (1) ON CONFLICT (id) DO NOTHING`,
  // NOTE: nessus_key stores AES-256-GCM ciphertext (see utils/crypto.js),
  // written/read via nessusStatusController.js — never plaintext.
  `CREATE TABLE IF NOT EXISTS nessus_install_config (
      id                     INTEGER PRIMARY KEY DEFAULT 1,
      linux_install_method   VARCHAR(16) DEFAULT 'file',
      linux_file_path        TEXT,
      linux_cmd              TEXT,
      windows_method         VARCHAR(16) DEFAULT 'auto',
      windows_file_path      TEXT,
      windows_cmd            TEXT,
      windows_psexec_path    TEXT,
      windows_winrm_port     INTEGER DEFAULT 5985,
      windows_smb_port       INTEGER DEFAULT 445,
      skip_if_installed      BOOLEAN DEFAULT FALSE,
      log_file_path          TEXT,
      nessus_server          TEXT,
      nessus_port            INTEGER DEFAULT 8834,
      nessus_key             TEXT,
      nessus_groups          TEXT,
      updated_by             UUID REFERENCES users(id) ON DELETE SET NULL,
      updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
   )`,
  `INSERT INTO nessus_install_config (id) VALUES (1) ON CONFLICT (id) DO NOTHING`,

  // ── per-location ME installer config (add_software_install_location_config.sql)
  `CREATE TABLE IF NOT EXISTS software_install_location_config (
      location               VARCHAR(255) PRIMARY KEY,
      linux_file_path        TEXT,
      linux_serverinfo_path  TEXT,
      linux_cmd              TEXT,
      windows_method         VARCHAR(16),
      windows_file_path      TEXT,
      windows_cmd            TEXT,
      windows_psexec_path    TEXT,
      windows_winrm_port     INTEGER,
      windows_smb_port       INTEGER,
      updated_by             UUID REFERENCES users(id) ON DELETE SET NULL,
      updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
   )`,

  // ── VMware-to-Proxmox migration tracker tables ───────────────────────────
  `CREATE TABLE IF NOT EXISTS migration_hosts (
      id                    SERIAL PRIMARY KEY,
      vcenter               VARCHAR(255),
      host                  VARCHAR(255) NOT NULL,
      datacenter            VARCHAR(255),
      idrac                 VARCHAR(255),
      idrac_username_enc    TEXT,
      idrac_password_enc    TEXT,
      idrac_virtual_console VARCHAR(255),
      assigned_licenses     TEXT,
      esx_version           VARCHAR(128),
      model                 VARCHAR(255),
      serial_number         VARCHAR(128),
      bios_vendor           VARCHAR(128),
      min_cores             INTEGER,
      license_expiry_date   DATE,
      assigned_to           VARCHAR(255),
      vms_to_migrate        INTEGER,
      powered_off_vms       INTEGER,
      host_owner            VARCHAR(255),
      vms_vacate            VARCHAR(64)  NOT NULL DEFAULT 'Pending',
      proxmox_install       VARCHAR(64)  NOT NULL DEFAULT 'Pending',
      vm_migration_back     VARCHAR(64)  NOT NULL DEFAULT 'Pending',
      notes                 TEXT,
      created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
   )`,
  `CREATE INDEX IF NOT EXISTS idx_migration_hosts_datacenter ON migration_hosts(datacenter)`,
  `CREATE INDEX IF NOT EXISTS idx_migration_hosts_host       ON migration_hosts(host)`,

  `CREATE TABLE IF NOT EXISTS migration_bomgar_vms (
      id                        SERIAL PRIMARY KEY,
      vm                        VARCHAR(255) NOT NULL,
      powerstate                VARCHAR(64),
      dns_name                  VARCHAR(255),
      cpus                      INTEGER,
      memory_mib                BIGINT,
      active_memory_mib         BIGINT,
      nics                      INTEGER,
      disks                     INTEGER,
      total_disk_capacity_mib   BIGINT,
      primary_ip                VARCHAR(64),
      network_1                 VARCHAR(255),
      firmware                  VARCHAR(128),
      hw_version                VARCHAR(64),
      path                      TEXT,
      datacenter                VARCHAR(255),
      cluster                   VARCHAR(255),
      host                      VARCHAR(255),
      os_config                 VARCHAR(255),
      os_tools                  VARCHAR(255),
      vm_id                     VARCHAR(128),
      migration_status          VARCHAR(64)  NOT NULL DEFAULT 'Not Started',
      notes                     TEXT,
      created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
   )`,
  `CREATE INDEX IF NOT EXISTS idx_migration_bomgar_host   ON migration_bomgar_vms(host)`,
  `CREATE INDEX IF NOT EXISTS idx_migration_bomgar_status ON migration_bomgar_vms(migration_status)`,

  `CREATE TABLE IF NOT EXISTS migration_security_vms (
      id                        SERIAL PRIMARY KEY,
      vm                        VARCHAR(255) NOT NULL,
      primary_ip                VARCHAR(64),
      mac_address               VARCHAR(128),
      host                      VARCHAR(255),
      powerstate                VARCHAR(64),
      guest_state               VARCHAR(128),
      cpus                      INTEGER,
      memory_mib                BIGINT,
      nics                      INTEGER,
      disks                     INTEGER,
      total_disk_capacity_mib   BIGINT,
      network_1                 VARCHAR(255),
      firmware                  VARCHAR(128),
      hw_version                VARCHAR(64),
      os_config                 VARCHAR(255),
      os_tools                  VARCHAR(255),
      vm_id                     VARCHAR(128),
      vm_uuid                   VARCHAR(255),
      migration_status          VARCHAR(64)  NOT NULL DEFAULT 'Not Started',
      notes                     TEXT,
      created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
   )`,
  `CREATE INDEX IF NOT EXISTS idx_migration_security_host   ON migration_security_vms(host)`,
  `CREATE INDEX IF NOT EXISTS idx_migration_security_status ON migration_security_vms(migration_status)`,

  `CREATE TABLE IF NOT EXISTS migration_standalone_esxi (
      id                        SERIAL PRIMARY KEY,
      vm                        VARCHAR(255) NOT NULL,
      primary_ip                VARCHAR(64),
      mac_address               VARCHAR(128),
      host                      VARCHAR(255),
      powerstate                VARCHAR(64),
      guest_state               VARCHAR(128),
      cpus                      INTEGER,
      memory_mib                BIGINT,
      nics                      INTEGER,
      disks                     INTEGER,
      total_disk_capacity_mib   BIGINT,
      network_1                 VARCHAR(255),
      firmware                  VARCHAR(128),
      hw_version                VARCHAR(64),
      os_config                 VARCHAR(255),
      os_tools                  VARCHAR(255),
      vi_sdk_api_version        VARCHAR(64),
      vi_sdk_server             VARCHAR(255),
      migration_status          VARCHAR(64)  NOT NULL DEFAULT 'Not Started',
      notes                     TEXT,
      created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
   )`,
  `CREATE INDEX IF NOT EXISTS idx_migration_standalone_host   ON migration_standalone_esxi(host)`,
  `CREATE INDEX IF NOT EXISTS idx_migration_standalone_status ON migration_standalone_esxi(migration_status)`,

  // ── MIGRATION PROJECTS ──────────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS migration_projects (
      id          SERIAL PRIMARY KEY,
      name        VARCHAR(200) NOT NULL,
      environment VARCHAR(100),
      description TEXT,
      is_default  BOOLEAN      NOT NULL DEFAULT false,
      created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
      updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
   )`,
  `INSERT INTO migration_projects (name, environment, description, is_default)
   SELECT 'Default Project', 'Production', 'Initial migration project', true
   WHERE NOT EXISTS (SELECT 1 FROM migration_projects)`,
  `ALTER TABLE migration_hosts            ADD COLUMN IF NOT EXISTS project_id INTEGER REFERENCES migration_projects(id)`,
  `ALTER TABLE migration_bomgar_vms       ADD COLUMN IF NOT EXISTS project_id INTEGER REFERENCES migration_projects(id)`,
  `ALTER TABLE migration_security_vms     ADD COLUMN IF NOT EXISTS project_id INTEGER REFERENCES migration_projects(id)`,
  `ALTER TABLE migration_standalone_esxi  ADD COLUMN IF NOT EXISTS project_id INTEGER REFERENCES migration_projects(id)`,
  `UPDATE migration_hosts            SET project_id = (SELECT id FROM migration_projects WHERE is_default ORDER BY id LIMIT 1) WHERE project_id IS NULL`,
  `UPDATE migration_bomgar_vms       SET project_id = (SELECT id FROM migration_projects WHERE is_default ORDER BY id LIMIT 1) WHERE project_id IS NULL`,
  `UPDATE migration_security_vms     SET project_id = (SELECT id FROM migration_projects WHERE is_default ORDER BY id LIMIT 1) WHERE project_id IS NULL`,
  `UPDATE migration_standalone_esxi  SET project_id = (SELECT id FROM migration_projects WHERE is_default ORDER BY id LIMIT 1) WHERE project_id IS NULL`,
  `ALTER TABLE migration_projects ADD COLUMN IF NOT EXISTS stage_options JSONB NOT NULL DEFAULT '["Pending","In Progress","Completed"]'`,
  `ALTER TABLE migration_projects ADD COLUMN IF NOT EXISTS assigned_to_options JSONB NOT NULL DEFAULT '[]'`,

  // ── MIGRATION TAB CONFIG ─────────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS migration_tab_configs (
      id             SERIAL PRIMARY KEY,
      project_id     INTEGER NOT NULL REFERENCES migration_projects(id) ON DELETE CASCADE,
      tab_key        VARCHAR(50) NOT NULL,
      label          VARCHAR(200),
      enabled        BOOLEAN NOT NULL DEFAULT true,
      hidden_columns TEXT[]  NOT NULL DEFAULT '{}',
      created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(project_id, tab_key)
   )`,

  // ── MIGRATION CUSTOM TABS ─────────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS migration_custom_tabs (
      id             SERIAL PRIMARY KEY,
      project_id     INTEGER NOT NULL REFERENCES migration_projects(id) ON DELETE CASCADE,
      label          VARCHAR(200) NOT NULL,
      sort_order     INTEGER NOT NULL DEFAULT 0,
      enabled        BOOLEAN NOT NULL DEFAULT true,
      hidden_columns TEXT[]  NOT NULL DEFAULT '{}',
      created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
   )`,
  `CREATE TABLE IF NOT EXISTS migration_custom_vms (
      id                        SERIAL PRIMARY KEY,
      custom_tab_id             INTEGER NOT NULL REFERENCES migration_custom_tabs(id) ON DELETE CASCADE,
      project_id                INTEGER NOT NULL REFERENCES migration_projects(id) ON DELETE CASCADE,
      vm                        VARCHAR(255) NOT NULL,
      migration_status          VARCHAR(50)  DEFAULT 'Not Started',
      powerstate                VARCHAR(50),
      guest_state               VARCHAR(50),
      primary_ip                VARCHAR(50),
      mac_address               VARCHAR(50),
      dns_name                  VARCHAR(255),
      host                      VARCHAR(255),
      cpus                      INTEGER,
      memory_mib                BIGINT,
      total_disk_capacity_mib   BIGINT,
      nics                      INTEGER,
      disks                     INTEGER,
      os_config                 VARCHAR(500),
      os_tools                  VARCHAR(500),
      datacenter                VARCHAR(255),
      cluster                   VARCHAR(255),
      path                      VARCHAR(500),
      created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
   )`,
  `CREATE INDEX IF NOT EXISTS idx_migration_custom_vms_tab ON migration_custom_vms(custom_tab_id)`,

  // ── MIGRATION CUSTOM FIELD DEFINITIONS ──────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS migration_field_definitions (
      id          SERIAL PRIMARY KEY,
      project_id  INTEGER NOT NULL REFERENCES migration_projects(id) ON DELETE CASCADE,
      tab_key     VARCHAR(100) NOT NULL,
      label       VARCHAR(200) NOT NULL,
      field_type  VARCHAR(50)  NOT NULL DEFAULT 'text',
      options     JSONB,
      sort_order  INTEGER NOT NULL DEFAULT 0,
      required    BOOLEAN NOT NULL DEFAULT false,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
   )`,
  `CREATE INDEX IF NOT EXISTS idx_migration_field_defs_proj ON migration_field_definitions(project_id, tab_key)`,

  `CREATE TABLE IF NOT EXISTS migration_field_values (
      id           SERIAL PRIMARY KEY,
      field_def_id INTEGER NOT NULL REFERENCES migration_field_definitions(id) ON DELETE CASCADE,
      record_type  VARCHAR(50)  NOT NULL,
      record_id    INTEGER NOT NULL,
      value_text   TEXT,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(field_def_id, record_id)
   )`,
  `CREATE INDEX IF NOT EXISTS idx_migration_field_vals_record ON migration_field_values(record_type, record_id)`,

  // ── Server Models catalogue (dedicated table for Physical Server registration)
  `CREATE TABLE IF NOT EXISTS server_models (
      id           SERIAL PRIMARY KEY,
      manufacturer VARCHAR(255),
      model_name   VARCHAR(255) NOT NULL,
      notes        TEXT,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
   )`,
  `CREATE INDEX IF NOT EXISTS idx_server_models_manufacturer ON server_models(manufacturer)`,
  `CREATE INDEX IF NOT EXISTS idx_server_models_name        ON server_models(model_name)`,

  // ── Physical Server dedicated fields (add_physical_server_fields.sql)
  `ALTER TABLE physical_esxi_servers ADD COLUMN IF NOT EXISTS server_model    VARCHAR(255)`,
  `ALTER TABLE physical_esxi_servers ADD COLUMN IF NOT EXISTS cpu_cores       INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE physical_esxi_servers ADD COLUMN IF NOT EXISTS ram_gb          INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE physical_esxi_servers ADD COLUMN IF NOT EXISTS total_disks     INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE physical_esxi_servers ADD COLUMN IF NOT EXISTS rack_number     VARCHAR(100)`,
  `ALTER TABLE physical_esxi_servers ADD COLUMN IF NOT EXISTS server_position VARCHAR(100)`,

  // ── iDRAC credentials (separate from asset_username/asset_password)
  `ALTER TABLE physical_esxi_servers ADD COLUMN IF NOT EXISTS idrac_username           VARCHAR(255)`,
  `ALTER TABLE physical_esxi_servers ADD COLUMN IF NOT EXISTS idrac_password_encrypted TEXT`,

  // ── Remove fields not applicable to physical/ESXi servers
  `ALTER TABLE physical_esxi_servers DROP COLUMN IF EXISTS manage_engine_installed`,
  `ALTER TABLE physical_esxi_servers DROP COLUMN IF EXISTS tenable_installed`,
  `ALTER TABLE physical_esxi_servers DROP COLUMN IF EXISTS eol_status`,
  `ALTER TABLE physical_esxi_servers DROP COLUMN IF EXISTS server_patch_type`,
  `ALTER TABLE physical_esxi_servers DROP COLUMN IF EXISTS patching_schedule`,

  // ── Patching Type re-added to Physical & ESXi Servers (dropdown, like
  //    Asset/Ext./Beijing Inventory), so a physical server can be explicitly
  //    tagged e.g. "Not Applicable" instead of having no field at all.
  `ALTER TABLE physical_esxi_servers ADD COLUMN IF NOT EXISTS patching_type VARCHAR(64)`,

  // ── soft-delete (cleared before migration) column on all migration VM/host tables
  `ALTER TABLE migration_bomgar_vms      ADD COLUMN IF NOT EXISTS cleared_at TIMESTAMPTZ`,
  `ALTER TABLE migration_security_vms    ADD COLUMN IF NOT EXISTS cleared_at TIMESTAMPTZ`,
  `ALTER TABLE migration_standalone_esxi ADD COLUMN IF NOT EXISTS cleared_at TIMESTAMPTZ`,
  `ALTER TABLE migration_hosts           ADD COLUMN IF NOT EXISTS cleared_at TIMESTAMPTZ`,
  `ALTER TABLE migration_custom_vms      ADD COLUMN IF NOT EXISTS cleared_at TIMESTAMPTZ`,

  // ── migration_status & notes added after initial table creation (ADD COLUMN is idempotent)
  `ALTER TABLE migration_bomgar_vms      ADD COLUMN IF NOT EXISTS migration_status VARCHAR(64) NOT NULL DEFAULT 'Not Started'`,
  `ALTER TABLE migration_security_vms    ADD COLUMN IF NOT EXISTS migration_status VARCHAR(64) NOT NULL DEFAULT 'Not Started'`,
  `ALTER TABLE migration_standalone_esxi ADD COLUMN IF NOT EXISTS migration_status VARCHAR(64) NOT NULL DEFAULT 'Not Started'`,
  `ALTER TABLE migration_custom_vms      ADD COLUMN IF NOT EXISTS migration_status VARCHAR(50)          DEFAULT 'Not Started'`,
  `ALTER TABLE migration_bomgar_vms      ADD COLUMN IF NOT EXISTS notes TEXT`,
  `ALTER TABLE migration_security_vms    ADD COLUMN IF NOT EXISTS notes TEXT`,
  `ALTER TABLE migration_standalone_esxi ADD COLUMN IF NOT EXISTS notes TEXT`,
  `CREATE INDEX IF NOT EXISTS idx_migration_bomgar_status     ON migration_bomgar_vms(migration_status)`,
  `CREATE INDEX IF NOT EXISTS idx_migration_security_status   ON migration_security_vms(migration_status)`,
  `CREATE INDEX IF NOT EXISTS idx_migration_standalone_status ON migration_standalone_esxi(migration_status)`,

  // ── Microsoft Teams notification config (single-row, singleton guard) ─────────

  `CREATE TABLE IF NOT EXISTS teams_notification_config (
      id                      SERIAL PRIMARY KEY,
      singleton               BOOLEAN NOT NULL DEFAULT TRUE UNIQUE,
      webhook_url             TEXT    NOT NULL DEFAULT '',
      enabled                 BOOLEAN NOT NULL DEFAULT FALSE,
      notify_new_asset        BOOLEAN NOT NULL DEFAULT TRUE,
      notify_asset_update     BOOLEAN NOT NULL DEFAULT TRUE,
      notify_decommission     BOOLEAN NOT NULL DEFAULT TRUE,
      notify_migration_status BOOLEAN NOT NULL DEFAULT TRUE,
      notify_host_down_vmware  BOOLEAN NOT NULL DEFAULT TRUE,
      notify_host_down_proxmox BOOLEAN NOT NULL DEFAULT TRUE,
      notify_host_down_hyperv  BOOLEAN NOT NULL DEFAULT TRUE,
      alert_window_enabled    BOOLEAN NOT NULL DEFAULT FALSE,
      alert_window_start      VARCHAR(5) NOT NULL DEFAULT '00:00',
      alert_window_end        VARCHAR(5) NOT NULL DEFAULT '23:59',
      alert_active_days       INTEGER[] NOT NULL DEFAULT ARRAY[0,1,2,3,4,5,6],
      updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
   )`,
  `ALTER TABLE teams_notification_config ADD COLUMN IF NOT EXISTS notify_host_down_vmware  BOOLEAN NOT NULL DEFAULT TRUE`,
  `ALTER TABLE teams_notification_config ADD COLUMN IF NOT EXISTS notify_host_down_proxmox BOOLEAN NOT NULL DEFAULT TRUE`,
  `ALTER TABLE teams_notification_config ADD COLUMN IF NOT EXISTS notify_host_down_hyperv  BOOLEAN NOT NULL DEFAULT TRUE`,
  // Active-hours window gating connectivity alerts only (host-down/recovered,
  // ping warning/critical/recovered) — other alert types always send.
  // Supports overnight windows (e.g. start 22:00, end 06:00).
  `ALTER TABLE teams_notification_config ADD COLUMN IF NOT EXISTS alert_window_enabled BOOLEAN NOT NULL DEFAULT FALSE`,
  `ALTER TABLE teams_notification_config ADD COLUMN IF NOT EXISTS alert_window_start    VARCHAR(5) NOT NULL DEFAULT '00:00'`,
  `ALTER TABLE teams_notification_config ADD COLUMN IF NOT EXISTS alert_window_end      VARCHAR(5) NOT NULL DEFAULT '23:59'`,
  // Day-of-week gate for the same connectivity alerts (0=Sunday..6=Saturday).
  // Applies regardless of alert_window_enabled — a day left unchecked here
  // drops connectivity alerts entirely for that day.
  `ALTER TABLE teams_notification_config ADD COLUMN IF NOT EXISTS alert_active_days INTEGER[] NOT NULL DEFAULT ARRAY[0,1,2,3,4,5,6]`,

  // ── Microsoft Hyper-V discovery ──────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS hyperv_hosts (
      id                SERIAL PRIMARY KEY,
      host              VARCHAR(255) UNIQUE NOT NULL,
      display_name      VARCHAR(255),
      username          VARCHAR(255) NOT NULL,
      password_encrypted TEXT,
      port              INT NOT NULL DEFAULT 5985,
      use_ssl           BOOLEAN NOT NULL DEFAULT FALSE,
      verify_ssl        BOOLEAN NOT NULL DEFAULT FALSE,
      interval_minutes  INT NOT NULL DEFAULT 60,
      scheduler_enabled BOOLEAN NOT NULL DEFAULT FALSE,
      last_discovery_at TIMESTAMPTZ,
      last_vm_count     INT DEFAULT 0,
      is_running        BOOLEAN NOT NULL DEFAULT FALSE,
      created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
   )`,
  // Last-run outcome is otherwise invisible: last_discovery_at/last_vm_count
  // are only ever set on SUCCESS (see hypervDbService.setLastDiscovery), so
  // a host that fails every run looks identical in the UI to one that has
  // never been triggered at all.
  `ALTER TABLE hyperv_hosts ADD COLUMN IF NOT EXISTS last_status VARCHAR(20)`,
  `ALTER TABLE hyperv_hosts ADD COLUMN IF NOT EXISTS last_error  TEXT`,
  `ALTER TABLE hyperv_hosts ADD COLUMN IF NOT EXISTS last_attempt_at TIMESTAMPTZ`,
  `ALTER TABLE hyperv_hosts ADD COLUMN IF NOT EXISTS discovery_fail_count INT NOT NULL DEFAULT 0`,
  `ALTER TABLE hyperv_hosts ADD COLUMN IF NOT EXISTS ping_status VARCHAR(10)`,
  `ALTER TABLE hyperv_hosts ADD COLUMN IF NOT EXISTS ping_fail_count INT NOT NULL DEFAULT 0`,
  `ALTER TABLE hyperv_hosts ADD COLUMN IF NOT EXISTS ping_last_checked_at TIMESTAMPTZ`,

  // ── Hyper-V discovery: host hardware telemetry (CPU/RAM/disk/uptime) via
  // CIM/WMI, collected alongside each discovery run — same Hosts &
  // Credentials hardware display added for VMware/Proxmox. A hyperv_hosts
  // row is always exactly one physical server, so no per-node breakdown
  // table is needed here (unlike VMware's vCenter-manages-many case).
  `ALTER TABLE hyperv_hosts ADD COLUMN IF NOT EXISTS hardware_model  VARCHAR(255)`,
  `ALTER TABLE hyperv_hosts ADD COLUMN IF NOT EXISTS cpu_cores       INT`,
  `ALTER TABLE hyperv_hosts ADD COLUMN IF NOT EXISTS cpu_usage_pct   NUMERIC(5,1)`,
  `ALTER TABLE hyperv_hosts ADD COLUMN IF NOT EXISTS memory_total_mb INT`,
  `ALTER TABLE hyperv_hosts ADD COLUMN IF NOT EXISTS memory_used_mb  INT`,
  `ALTER TABLE hyperv_hosts ADD COLUMN IF NOT EXISTS disk_total_gb   NUMERIC(10,1)`,
  `ALTER TABLE hyperv_hosts ADD COLUMN IF NOT EXISTS disk_used_gb    NUMERIC(10,1)`,
  `ALTER TABLE hyperv_hosts ADD COLUMN IF NOT EXISTS uptime_seconds  BIGINT`,

  `CREATE TABLE IF NOT EXISTS hyperv_discovery_runs (
      id            SERIAL PRIMARY KEY,
      host_id       INT NOT NULL REFERENCES hyperv_hosts(id) ON DELETE CASCADE,
      source_host   VARCHAR(255),
      status        VARCHAR(20) NOT NULL DEFAULT 'running',
      vm_count      INT DEFAULT 0,
      error_message TEXT,
      run_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
   )`,
  `CREATE INDEX IF NOT EXISTS idx_hyperv_runs_host ON hyperv_discovery_runs(host_id)`,
  `CREATE TABLE IF NOT EXISTS hyperv_discovered_vms (
      id              SERIAL PRIMARY KEY,
      run_id          INT NOT NULL REFERENCES hyperv_discovery_runs(id) ON DELETE CASCADE,
      host_id         INT NOT NULL REFERENCES hyperv_hosts(id) ON DELETE CASCADE,
      source_host     VARCHAR(255),
      vm_id           VARCHAR(255),
      name            VARCHAR(255),
      state           VARCHAR(50),
      generation      INT,
      cpu_count       INT,
      memory_mb       BIGINT,
      memory_type     VARCHAR(20),
      disk_gb         NUMERIC(12,2),
      ips             TEXT[],
      mac_addresses   TEXT[],
      os_name         VARCHAR(255),
      os_type         VARCHAR(50),
      uptime_seconds  BIGINT,
      is_template     BOOLEAN NOT NULL DEFAULT FALSE,
      snapshot_count  INT DEFAULT 0,
      snapshot_oldest TIMESTAMPTZ,
      cluster         VARCHAR(255),
      discovered_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
   )`,
  `CREATE INDEX IF NOT EXISTS idx_hyperv_vms_run  ON hyperv_discovered_vms(run_id)`,
  `CREATE INDEX IF NOT EXISTS idx_hyperv_vms_host ON hyperv_discovered_vms(host_id)`,

  // ── Change Field Types → Dropdown Master auto-linking
  `ALTER TABLE builtin_field_overrides ADD COLUMN IF NOT EXISTS dropdown_category VARCHAR(120)`,

  // ── Global search / GlobalSearch.jsx does ILIKE '%q%' (leading wildcard)
  // against vm_name/os_hostname/ip_address across all four asset tables —
  // a plain btree index (already present) can't be used for that pattern,
  // so every keystroke was a sequential scan. GIN trigram indexes make
  // ILIKE '%...%' sargable and get faster as row counts grow, which a
  // btree index never would.
  `CREATE EXTENSION IF NOT EXISTS pg_trgm`,
  `CREATE INDEX IF NOT EXISTS idx_assets_vm_name_trgm      ON assets USING GIN (vm_name gin_trgm_ops)`,
  `CREATE INDEX IF NOT EXISTS idx_assets_hostname_trgm     ON assets USING GIN (os_hostname gin_trgm_ops)`,
  `CREATE INDEX IF NOT EXISTS idx_assets_ip_trgm           ON assets USING GIN (ip_address gin_trgm_ops)`,
  `CREATE INDEX IF NOT EXISTS idx_beijing_vm_name_trgm     ON beijing_assets USING GIN (vm_name gin_trgm_ops)`,
  `CREATE INDEX IF NOT EXISTS idx_beijing_hostname_trgm    ON beijing_assets USING GIN (os_hostname gin_trgm_ops)`,
  `CREATE INDEX IF NOT EXISTS idx_beijing_ip_trgm          ON beijing_assets USING GIN (ip_address gin_trgm_ops)`,
  `CREATE INDEX IF NOT EXISTS idx_ext_vm_name_trgm         ON ext_assets USING GIN (vm_name gin_trgm_ops)`,
  `CREATE INDEX IF NOT EXISTS idx_ext_hostname_trgm        ON ext_assets USING GIN (os_hostname gin_trgm_ops)`,
  `CREATE INDEX IF NOT EXISTS idx_ext_ip_trgm              ON ext_assets USING GIN (ip_address gin_trgm_ops)`,
  `CREATE INDEX IF NOT EXISTS idx_phx_vm_name_trgm         ON physical_esxi_servers USING GIN (vm_name gin_trgm_ops)`,
  `CREATE INDEX IF NOT EXISTS idx_phx_hostname_trgm        ON physical_esxi_servers USING GIN (os_hostname gin_trgm_ops)`,
  `CREATE INDEX IF NOT EXISTS idx_phx_ip_trgm              ON physical_esxi_servers USING GIN (ip_address gin_trgm_ops)`,

  // ── Weekly Report: narrative/manual content (weeklyReportManualService.js)
  // and the archived, fully-frozen snapshot history (weeklyReportService.js,
  // written every Wednesday by weeklyReportScheduler.js).
  `CREATE TABLE IF NOT EXISTS weekly_report_manual_sections (
      id           SERIAL PRIMARY KEY,
      section_key  VARCHAR(64) UNIQUE NOT NULL,
      title        VARCHAR(255) NOT NULL,
      sort_order   INT NOT NULL,
      content      TEXT,
      updated_by   UUID REFERENCES users(id) ON DELETE SET NULL,
      updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
   )`,
  `CREATE TABLE IF NOT EXISTS weekly_report_snapshots (
      id            SERIAL PRIMARY KEY,
      report_date   DATE NOT NULL UNIQUE,
      sections      JSONB NOT NULL,
      generated_by  VARCHAR(20) NOT NULL DEFAULT 'scheduler',
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
   )`,
  // Seed one row per known manual section so the Inputs editor has something
  // to render on first load — INSERT is a no-op once a row already exists.
  `INSERT INTO weekly_report_manual_sections (section_key, title, sort_order) VALUES
     ('idrac_openmanage',       'Dell iDRAC and Open Manage',                 1),
     ('server_identity',        'Server Identity Management',                 2),
     ('bau_activities',         'Server Management / BAU Activities',         3),
     ('esxi_patching',          'ESXi Patching / Escape Vulnerability',        4),
     ('sop',                    'Define Approved Server Creation Process SOP',5),
     ('ticketing',              'Ticketing Data',                             6),
     ('queries_challenges',     'Queries to Lin / Challenges',                7),
     ('migration_narrative',    'Migration Project — Scope, Progress & Challenges', 8),
     ('vulnerability_mitigation','Vulnerability Mitigation',                  9),
     ('eol_tracker',            'EOL Project Tracker',                       10),
     ('licenses',               'Licenses',                                  11)
   ON CONFLICT (section_key) DO NOTHING`,
];

// Backfill: records that already carry a decommissioned server_status get
// stamped and logged once. RETURNING makes this idempotent — subsequent
// startups find nothing to stamp.
async function backfillDecommissioned() {
  for (const t of ['assets', 'beijing_assets', 'ext_assets', 'physical_esxi_servers']) {
    try {
      const { rows } = await db.query(
        `UPDATE ${t}
            SET decommissioned_at = NOW()
          WHERE server_status ILIKE 'decom%'
            AND decommissioned_at IS NULL
            AND deleted_at IS NULL
        RETURNING id, vm_name, os_hostname, ip_address::text AS ip_address, asset_tag,
                  serial_number, os_type, location, hosted_ip`,
      );
      for (const r of rows) {
        await db.query(
          `INSERT INTO decommission_log
             (source, asset_id, vm_name, os_hostname, ip_address, asset_tag,
              serial_number, os_type, location, hosted_ip, reason, decommissioned_by_name)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
          [t, r.id, r.vm_name, r.os_hostname, r.ip_address, r.asset_tag,
           r.serial_number, r.os_type, r.location, r.hosted_ip,
           'Backfilled from existing server status', 'system'],
        );
      }
      if (rows.length) console.log(`[ensure-schema] backfilled ${rows.length} decommissioned record(s) in ${t}`);
    } catch (e) {
      console.error(`[ensure-schema] decommission backfill failed for ${t}:`, e.message);
    }
  }
}

async function ensureSchema() {
  let applied = 0;
  for (const sql of STATEMENTS) {
    try {
      await db.query(sql);
      applied++;
    } catch (e) {
      // Log and continue — one failed statement must not block startup or
      // the remaining statements.
      console.error('[ensure-schema] statement failed:', e.message);
    }
  }
  await backfillDecommissioned();
  console.log(`[ensure-schema] ${applied}/${STATEMENTS.length} statements applied`);
}

module.exports = ensureSchema;
