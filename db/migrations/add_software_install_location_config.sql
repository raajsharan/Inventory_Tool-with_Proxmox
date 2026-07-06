-- =====================================================================
-- Migration: per-location ManageEngine installer configuration.
--
-- Each location can have its own installer files / commands. During
-- deployment the VM's location row (if present) is merged over the
-- global software_install_config; NULL/empty fields inherit the default.
--
-- Run ONCE on any existing database.
-- =====================================================================

CREATE TABLE IF NOT EXISTS software_install_location_config (
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
);
