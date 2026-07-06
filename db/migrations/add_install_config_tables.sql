-- =====================================================================
-- Migration: Add software_install_config + nessus_install_config tables.
--
-- These were referenced by the Software Status (ManageEngine) and Nessus
-- Agent Status pages but never added to schema.sql. Without them, GET
-- /software-status/install-config and /nessus-status/install-config
-- return 500 (relation does not exist), and both pages blank out to
-- "Total Active VMs: 0" / "No data".
--
-- Run ONCE on any existing database.
-- =====================================================================

CREATE TABLE IF NOT EXISTS software_install_config (
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
);
INSERT INTO software_install_config (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS nessus_install_config (
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
);
INSERT INTO nessus_install_config (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
