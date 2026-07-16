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

  // ── Remove fields not applicable to physical/ESXi servers
  `ALTER TABLE physical_esxi_servers DROP COLUMN IF EXISTS manage_engine_installed`,
  `ALTER TABLE physical_esxi_servers DROP COLUMN IF EXISTS tenable_installed`,
  `ALTER TABLE physical_esxi_servers DROP COLUMN IF EXISTS eol_status`,
  `ALTER TABLE physical_esxi_servers DROP COLUMN IF EXISTS patching_type`,
  `ALTER TABLE physical_esxi_servers DROP COLUMN IF EXISTS server_patch_type`,
  `ALTER TABLE physical_esxi_servers DROP COLUMN IF EXISTS patching_schedule`,

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
      updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
   )`,

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
