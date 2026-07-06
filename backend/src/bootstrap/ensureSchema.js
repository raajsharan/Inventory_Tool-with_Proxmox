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
];

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
  console.log(`[ensure-schema] ${applied}/${STATEMENTS.length} statements applied`);
}

module.exports = ensureSchema;
