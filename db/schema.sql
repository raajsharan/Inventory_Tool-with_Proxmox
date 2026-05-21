-- =====================================================================
-- Infrastructure Inventory Management Tool — PostgreSQL Schema
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ---------------------------------------------------------------------
-- users
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email           VARCHAR(255) UNIQUE NOT NULL,
    full_name       VARCHAR(255) NOT NULL,
    password_hash   VARCHAR(255) NOT NULL,
    role            VARCHAR(32) NOT NULL CHECK (role IN ('superadmin','admin','asset_manager','viewer')),
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    last_login_at   TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- For existing deployments: widen the role CHECK to include 'superadmin'.
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users
  ADD CONSTRAINT users_role_check
  CHECK (role IN ('superadmin','admin','asset_manager','viewer'));

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);

-- ---------------------------------------------------------------------
-- dropdown_master
--   Holds dropdown options for OS Type, OS Version, Server Status, etc.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS dropdown_master (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    category        VARCHAR(64) NOT NULL,
    value           VARCHAR(255) NOT NULL,
    parent_value    VARCHAR(255),         -- e.g. OS Version belongs to an OS Type
    sort_order      INT NOT NULL DEFAULT 0,
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (category, value, parent_value)
);

CREATE INDEX IF NOT EXISTS idx_dropdown_category ON dropdown_master(category);

-- ---------------------------------------------------------------------
-- department_tag_ranges
--   Admin-managed list of departments and their allowed asset-tag
--   numeric ranges. Replaces the previously hardcoded mapping.
--   Ranges may overlap across departments.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS department_tag_ranges (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name            VARCHAR(255) UNIQUE NOT NULL,
    min_tag         INT NOT NULL,
    max_tag         INT NOT NULL,
    sort_order      INT NOT NULL DEFAULT 0,
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (min_tag >= 0 AND max_tag >= min_tag)
);

CREATE INDEX IF NOT EXISTS idx_dept_ranges_active ON department_tag_ranges(is_active);

INSERT INTO department_tag_ranges (name, min_tag, max_tag, sort_order) VALUES
  ('IT Team',                            1,    1000, 1),
  ('Platform Team',                      1000, 2000, 2),
  ('Boston Team (QA)',                   2000, 4000, 3),
  ('Toronto Team (QA)',                  2000, 4000, 4),
  ('Bomgar Team',                        2000, 4000, 5),
  ('Support & Service',                  4000, 5000, 6),
  ('Lab Team',                           5000, 6000, 7),
  ('Joey''s Team (Dev)',                 6000, 7000, 8),
  ('Architecture Team',                  7000, 8000, 9),
  ('PM, Support & NEA and other teams',  8000, 8500, 10),
  ('Security Team',                      8501, 9000, 11),
  ('POC Team',                           9000, 9500, 12)
ON CONFLICT (name) DO NOTHING;

-- ---------------------------------------------------------------------
-- assets
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS assets (
    id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vm_name                  VARCHAR(255) NOT NULL UNIQUE,
    os_hostname              VARCHAR(255),
    ip_address               VARCHAR(45)  NOT NULL UNIQUE,
    asset_type               VARCHAR(128),
    os_type                  VARCHAR(128),
    os_version               VARCHAR(128),
    assigned_user            VARCHAR(255),
    department               VARCHAR(255),
    business_purpose         TEXT,
    server_status            VARCHAR(64),
    patching_type            VARCHAR(64),
    server_patch_type        VARCHAR(64),
    patching_schedule        VARCHAR(128),
    location                 VARCHAR(128),
    eol_status               VARCHAR(64),
    serial_number            VARCHAR(128),
    ome_status               VARCHAR(64),
    hosted_ip                VARCHAR(45),
    asset_tag                VARCHAR(128) UNIQUE,
    asset_username           VARCHAR(255),
    asset_password_encrypted TEXT,         -- AES-256-GCM ciphertext
    additional_remarks       TEXT,
    manage_engine_installed  BOOLEAN NOT NULL DEFAULT FALSE,
    tenable_installed        BOOLEAN NOT NULL DEFAULT FALSE,
    idrac_enabled            BOOLEAN NOT NULL DEFAULT FALSE,
    created_by               UUID REFERENCES users(id) ON DELETE SET NULL,
    updated_by               UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_assets_vm_name       ON assets(vm_name);
CREATE INDEX IF NOT EXISTS idx_assets_ip            ON assets(ip_address);
CREATE INDEX IF NOT EXISTS idx_assets_asset_tag     ON assets(asset_tag);
CREATE INDEX IF NOT EXISTS idx_assets_os_type       ON assets(os_type);
CREATE INDEX IF NOT EXISTS idx_assets_server_status ON assets(server_status);
CREATE INDEX IF NOT EXISTS idx_assets_location      ON assets(location);
CREATE INDEX IF NOT EXISTS idx_assets_eol_status    ON assets(eol_status);
CREATE INDEX IF NOT EXISTS idx_assets_department    ON assets(department);

-- ---------------------------------------------------------------------
-- beijing_assets
--   Parallel asset inventory for the Beijing region. Same shape as assets
--   but completely independent (own UNIQUE constraints, own tag numbering).
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS beijing_assets (
    id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vm_name                  VARCHAR(255) NOT NULL UNIQUE,
    os_hostname              VARCHAR(255),
    ip_address               VARCHAR(45)  NOT NULL UNIQUE,
    asset_type               VARCHAR(128),
    os_type                  VARCHAR(128),
    os_version               VARCHAR(128),
    assigned_user            VARCHAR(255),
    department               VARCHAR(255),
    business_purpose         TEXT,
    server_status            VARCHAR(64),
    patching_type            VARCHAR(64),
    server_patch_type        VARCHAR(64),
    patching_schedule        VARCHAR(128),
    location                 VARCHAR(128),
    eol_status               VARCHAR(64),
    serial_number            VARCHAR(128),
    ome_status               VARCHAR(64),
    hosted_ip                VARCHAR(45),
    asset_tag                VARCHAR(128) UNIQUE,
    asset_username           VARCHAR(255),
    asset_password_encrypted TEXT,
    additional_remarks       TEXT,
    manage_engine_installed  BOOLEAN NOT NULL DEFAULT FALSE,
    tenable_installed        BOOLEAN NOT NULL DEFAULT FALSE,
    idrac_enabled            BOOLEAN NOT NULL DEFAULT FALSE,
    created_by               UUID REFERENCES users(id) ON DELETE SET NULL,
    updated_by               UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_beijing_vm_name      ON beijing_assets(vm_name);
CREATE INDEX IF NOT EXISTS idx_beijing_ip           ON beijing_assets(ip_address);
CREATE INDEX IF NOT EXISTS idx_beijing_asset_tag    ON beijing_assets(asset_tag);
CREATE INDEX IF NOT EXISTS idx_beijing_department   ON beijing_assets(department);

-- ---------------------------------------------------------------------
-- ext_assets
--   Parallel "Extended" asset inventory. Same shape as assets, fully
--   independent table. Shares the global asset_tag + ip_address pools
--   via application-layer cross-table checks.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ext_assets (
    id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vm_name                  VARCHAR(255) NOT NULL UNIQUE,
    os_hostname              VARCHAR(255),
    ip_address               VARCHAR(45)  NOT NULL UNIQUE,
    asset_type               VARCHAR(128),
    os_type                  VARCHAR(128),
    os_version               VARCHAR(128),
    assigned_user            VARCHAR(255),
    department               VARCHAR(255),
    business_purpose         TEXT,
    server_status            VARCHAR(64),
    patching_type            VARCHAR(64),
    server_patch_type        VARCHAR(64),
    patching_schedule        VARCHAR(128),
    location                 VARCHAR(128),
    eol_status               VARCHAR(64),
    serial_number            VARCHAR(128),
    ome_status               VARCHAR(64),
    hosted_ip                VARCHAR(45),
    asset_tag                VARCHAR(128) UNIQUE,
    asset_username           VARCHAR(255),
    asset_password_encrypted TEXT,
    additional_remarks       TEXT,
    manage_engine_installed  BOOLEAN NOT NULL DEFAULT FALSE,
    tenable_installed        BOOLEAN NOT NULL DEFAULT FALSE,
    idrac_enabled            BOOLEAN NOT NULL DEFAULT FALSE,
    created_by               UUID REFERENCES users(id) ON DELETE SET NULL,
    updated_by               UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ext_vm_name      ON ext_assets(vm_name);
CREATE INDEX IF NOT EXISTS idx_ext_ip           ON ext_assets(ip_address);
CREATE INDEX IF NOT EXISTS idx_ext_asset_tag    ON ext_assets(asset_tag);
CREATE INDEX IF NOT EXISTS idx_ext_department   ON ext_assets(department);

-- ---------------------------------------------------------------------
-- physical_esxi_servers
--   Combined Physical Server + ESXi inventory. Same shape as assets and
--   shares the global asset_tag + ip_address pools via application-layer
--   checks. Use the `asset_type` field on each row to distinguish
--   physical vs. ESXi entries.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS physical_esxi_servers (
    id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vm_name                  VARCHAR(255) NOT NULL UNIQUE,
    os_hostname              VARCHAR(255),
    ip_address               VARCHAR(45)  NOT NULL UNIQUE,
    asset_type               VARCHAR(128),
    os_type                  VARCHAR(128),
    os_version               VARCHAR(128),
    assigned_user            VARCHAR(255),
    department               VARCHAR(255),
    business_purpose         TEXT,
    server_status            VARCHAR(64),
    patching_type            VARCHAR(64),
    server_patch_type        VARCHAR(64),
    patching_schedule        VARCHAR(128),
    location                 VARCHAR(128),
    eol_status               VARCHAR(64),
    serial_number            VARCHAR(128),
    ome_status               VARCHAR(64),
    hosted_ip                VARCHAR(45),
    asset_tag                VARCHAR(128) UNIQUE,
    asset_username           VARCHAR(255),
    asset_password_encrypted TEXT,
    additional_remarks       TEXT,
    manage_engine_installed  BOOLEAN NOT NULL DEFAULT FALSE,
    tenable_installed        BOOLEAN NOT NULL DEFAULT FALSE,
    idrac_enabled            BOOLEAN NOT NULL DEFAULT FALSE,
    created_by               UUID REFERENCES users(id) ON DELETE SET NULL,
    updated_by               UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_phx_vm_name    ON physical_esxi_servers(vm_name);
CREATE INDEX IF NOT EXISTS idx_phx_ip         ON physical_esxi_servers(ip_address);
CREATE INDEX IF NOT EXISTS idx_phx_asset_tag  ON physical_esxi_servers(asset_tag);
CREATE INDEX IF NOT EXISTS idx_phx_department ON physical_esxi_servers(department);

-- ---------------------------------------------------------------------
-- custom_pages
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS custom_pages (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name            VARCHAR(128) NOT NULL UNIQUE,
    slug            VARCHAR(128) NOT NULL UNIQUE,
    description     TEXT,
    icon            VARCHAR(64),
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    created_by      UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------
-- custom_page_fields
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS custom_page_fields (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    page_id         UUID NOT NULL REFERENCES custom_pages(id) ON DELETE CASCADE,
    field_key       VARCHAR(128) NOT NULL,
    label           VARCHAR(255) NOT NULL,
    field_type      VARCHAR(32)  NOT NULL CHECK (field_type IN ('text','textarea','number','dropdown','toggle','date')),
    options         JSONB,                  -- for dropdown options
    is_required     BOOLEAN NOT NULL DEFAULT FALSE,
    sort_order      INT NOT NULL DEFAULT 0,
    section         VARCHAR(64) NOT NULL DEFAULT 'General',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (page_id, field_key)
);

-- For existing deployments
ALTER TABLE custom_page_fields ADD COLUMN IF NOT EXISTS section VARCHAR(64) NOT NULL DEFAULT 'General';

CREATE INDEX IF NOT EXISTS idx_cpf_page_id ON custom_page_fields(page_id);

-- ---------------------------------------------------------------------
-- custom_page_records
--   JSONB document keyed by field_key
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS custom_page_records (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    page_id         UUID NOT NULL REFERENCES custom_pages(id) ON DELETE CASCADE,
    data            JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_by      UUID REFERENCES users(id) ON DELETE SET NULL,
    updated_by      UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cpr_page_id ON custom_page_records(page_id);
CREATE INDEX IF NOT EXISTS idx_cpr_data    ON custom_page_records USING GIN (data);

-- ---------------------------------------------------------------------
-- import_logs
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS import_logs (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    filename        VARCHAR(255),
    total_rows      INT NOT NULL DEFAULT 0,
    success_rows    INT NOT NULL DEFAULT 0,
    failed_rows     INT NOT NULL DEFAULT 0,
    error_details   JSONB,                  -- [{row, errors:[]}]
    imported_by     UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_import_logs_created ON import_logs(created_at DESC);

-- ---------------------------------------------------------------------
-- audit_logs
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS audit_logs (
    id              BIGSERIAL PRIMARY KEY,
    user_id         UUID REFERENCES users(id) ON DELETE SET NULL,
    user_email      VARCHAR(255),
    action          VARCHAR(64) NOT NULL,    -- LOGIN, CREATE, UPDATE, DELETE, IMPORT, EXPORT
    entity_type     VARCHAR(64),             -- asset, user, custom_page, ...
    entity_id       VARCHAR(64),
    details         JSONB,
    ip_address      VARCHAR(45),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_user    ON audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_entity  ON audit_logs(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at DESC);

-- ---------------------------------------------------------------------
-- page_field_visibility
--   Stores per-page hidden field keys, so admins can hide fields from
--   the built-in pages (Assets, Beijing Assets, ...). Default visibility
--   is "everything shown" — only hidden keys are persisted.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS page_field_visibility (
    page_key   VARCHAR(64) PRIMARY KEY,
    hidden     JSONB NOT NULL DEFAULT '[]'::jsonb,
    updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ManageEngine + Tenable are not applicable on Physical & ESXi by default.
-- Admins can re-enable individual fields via Administration → Field Customization.
INSERT INTO page_field_visibility (page_key, hidden)
VALUES ('physical_esxi_servers', '["manage_engine_installed","tenable_installed"]'::jsonb)
ON CONFLICT (page_key) DO NOTHING;

-- ---------------------------------------------------------------------
-- page_access
--   Per-page, per-role visibility/access matrix. Default behavior when no
--   row exists for a (page_key, role) is "allowed = TRUE" — the system runs
--   open until admins start restricting. Superadmin always bypasses.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS page_access (
    page_key    VARCHAR(128) NOT NULL,
    role        VARCHAR(32)  NOT NULL,
    allowed     BOOLEAN NOT NULL DEFAULT TRUE,
    updated_by  UUID REFERENCES users(id) ON DELETE SET NULL,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (page_key, role)
);
CREATE INDEX IF NOT EXISTS idx_page_access_role ON page_access(role);

-- ---------------------------------------------------------------------
-- builtin_page_overrides
--   Per-page label / description / icon overrides for the built-in
--   inventory pages (assets, beijing_assets, ext_assets,
--   physical_esxi_servers). Lets admins/superadmins rename or rebrand
--   built-ins without changing code.
-- ---------------------------------------------------------------------
-- ---------------------------------------------------------------------
-- builtin_field_overrides
--   Per-field overrides on the built-in inventory pages (assets,
--   beijing_assets, ext_assets, physical_esxi_servers):
--     - rename the label
--     - move to a different section group
--     - swap the input type (Text → Dropdown / Toggle / Number / Date /
--       Textarea). DB-linked dropdowns (Asset Type, OS Type, Department,
--       Server Status, EOL, Location, …) are not overridable.
--   Same table also stores admin-added "extra" custom fields (is_extra)
--   whose values live in the per-row `extras` JSONB column on each
--   inventory table.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS builtin_field_overrides (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    page_key     VARCHAR(64)  NOT NULL,
    field_key    VARCHAR(128) NOT NULL,
    is_extra     BOOLEAN NOT NULL DEFAULT FALSE,
    label        VARCHAR(255),
    section      VARCHAR(64),
    input_type   VARCHAR(32),               -- text|textarea|number|dropdown|toggle|date
    options      JSONB,                     -- for dropdown options (array of strings)
    is_required  BOOLEAN NOT NULL DEFAULT FALSE,
    sort_order   INT NOT NULL DEFAULT 0,
    updated_by   UUID REFERENCES users(id) ON DELETE SET NULL,
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (page_key, field_key)
);
CREATE INDEX IF NOT EXISTS idx_bfo_page_key ON builtin_field_overrides(page_key);

-- Per-row "extras" JSONB column on each built-in inventory table, keyed
-- by the field_key of an admin-added extra field.
ALTER TABLE assets                 ADD COLUMN IF NOT EXISTS extras JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE beijing_assets         ADD COLUMN IF NOT EXISTS extras JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE ext_assets             ADD COLUMN IF NOT EXISTS extras JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE physical_esxi_servers  ADD COLUMN IF NOT EXISTS extras JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE assets                 ADD COLUMN IF NOT EXISTS idrac_ip VARCHAR(64);
ALTER TABLE beijing_assets         ADD COLUMN IF NOT EXISTS idrac_ip VARCHAR(64);
ALTER TABLE ext_assets             ADD COLUMN IF NOT EXISTS idrac_ip VARCHAR(64);
ALTER TABLE physical_esxi_servers  ADD COLUMN IF NOT EXISTS idrac_ip VARCHAR(64);

-- ---------------------------------------------------------------------
-- app_branding (singleton row id=1) and user profile fields.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS app_branding (
    id              INT PRIMARY KEY DEFAULT 1,
    tool_name       VARCHAR(255) NOT NULL DEFAULT 'Inventory IT',
    company_name    VARCHAR(255) NOT NULL DEFAULT '',
    tagline         VARCHAR(255) NOT NULL DEFAULT 'Infrastructure',
    footer_html     TEXT NOT NULL DEFAULT '',
    logo_data_url   TEXT,
    updated_by      UUID REFERENCES users(id) ON DELETE SET NULL,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT app_branding_singleton CHECK (id = 1)
);
INSERT INTO app_branding (id, tool_name, company_name, tagline, footer_html)
VALUES (1, 'Inventory IT', '', 'Infrastructure',
        '© 2026 Inventory IT. All rights reserved.')
ON CONFLICT (id) DO NOTHING;

ALTER TABLE users ADD COLUMN IF NOT EXISTS first_name VARCHAR(128);
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_name VARCHAR(128);
ALTER TABLE users ADD COLUMN IF NOT EXISTS job_role VARCHAR(255);
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_data_url TEXT;

-- ---------------------------------------------------------------------
-- builtin_page_group_overrides — remembers each built-in page's group
-- list (renames, deletions, additions, empty groups). When no row exists
-- the inventoryFieldsService falls back to its DEFAULT_GROUPS array.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS builtin_page_group_overrides (
    page_key     VARCHAR(64) PRIMARY KEY,
    groups       JSONB NOT NULL DEFAULT '[]'::jsonb,
    updated_by   UUID REFERENCES users(id) ON DELETE SET NULL,
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS builtin_page_overrides (
    page_key    VARCHAR(64) PRIMARY KEY,
    name        VARCHAR(255),
    description TEXT,
    icon        VARCHAR(64),
    updated_by  UUID REFERENCES users(id) ON DELETE SET NULL,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------
-- updated_at trigger
-- ---------------------------------------------------------------------
-- ---------------------------------------------------------------------
-- backup_settings — one row per backup kind ('pg' or 'csv').
-- backup_runs    — history of each backup, manual or scheduled.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS backup_settings (
    kind            VARCHAR(16) PRIMARY KEY,         -- 'pg' or 'csv'
    enabled         BOOLEAN NOT NULL DEFAULT FALSE,
    frequency       VARCHAR(16) NOT NULL DEFAULT 'daily',  -- 'daily' | 'weekly' | 'monthly'
    time_24h        VARCHAR(5)  NOT NULL DEFAULT '09:00',  -- 'HH:MM'
    day_of_week     INT,                                   -- 0-6 for weekly
    day_of_month    INT,                                   -- 1-28 for monthly
    retain_days     INT NOT NULL DEFAULT 14,
    directory       TEXT NOT NULL DEFAULT '/backups/postgres',
    file_naming     VARCHAR(32) NOT NULL DEFAULT 'timestamped',  -- 'timestamped' | 'overwrite'
    csv_targets     JSONB NOT NULL DEFAULT '["assets","beijing_assets","ext_assets","physical_esxi_servers"]'::jsonb,
    updated_by      UUID REFERENCES users(id) ON DELETE SET NULL,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO backup_settings (kind, directory)
VALUES ('pg', '/backups/postgres') ON CONFLICT (kind) DO NOTHING;
INSERT INTO backup_settings (kind, directory)
VALUES ('csv', '/backups/csv')     ON CONFLICT (kind) DO NOTHING;

CREATE TABLE IF NOT EXISTS backup_runs (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    kind            VARCHAR(16) NOT NULL,         -- 'pg' or 'csv'
    trigger         VARCHAR(16) NOT NULL,         -- 'manual' | 'scheduled'
    status          VARCHAR(16) NOT NULL,         -- 'running' | 'ok' | 'error'
    file_path       TEXT,
    file_size       BIGINT,
    error           TEXT,
    started_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    finished_at     TIMESTAMPTZ,
    triggered_by    UUID REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_backup_runs_kind_started ON backup_runs(kind, started_at DESC);

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE
    t TEXT;
BEGIN
    FOR t IN
        SELECT unnest(ARRAY['users','dropdown_master','assets','beijing_assets','ext_assets','physical_esxi_servers','custom_pages','custom_page_records','department_tag_ranges','page_field_visibility','page_access','backup_settings'])
    LOOP
        EXECUTE format(
            'DROP TRIGGER IF EXISTS trg_%I_updated ON %I;
             CREATE TRIGGER trg_%I_updated BEFORE UPDATE ON %I
             FOR EACH ROW EXECUTE FUNCTION set_updated_at();',
            t, t, t, t
        );
    END LOOP;
END $$;
