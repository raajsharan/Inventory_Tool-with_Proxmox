-- =====================================================================
-- Migration: Add agent_push_* tables (Agent Push page).
--
-- Native, Linux-backend-compatible replacement for the standalone
-- agent_push_webapp Flask app (previously linked from the nav as
-- "ME Deploy Link", iframing out to a separate Windows VM). Its Windows
-- push relied on RemCom.exe (a Windows PE binary) and pywinpty (Win32
-- ConPTY) — neither can run here, so Windows push goes through WinRM
-- instead (see backend/src/services/agentPushWindowsPush.js).
--
-- This is documentation only — applied automatically and idempotently by
-- backend/src/bootstrap/ensureSchema.js on every server startup, same as
-- test_deploy_*'s tables. Running this file manually is optional.
-- =====================================================================

CREATE TABLE IF NOT EXISTS agent_push_locations (
    id           SERIAL PRIMARY KEY,
    name         VARCHAR(255) NOT NULL UNIQUE,
    folder_name  VARCHAR(255) NOT NULL UNIQUE,
    notes        TEXT,
    created_by   UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- password_encrypted stores AES-256-GCM ciphertext (utils/crypto.js), never plaintext.
CREATE TABLE IF NOT EXISTS agent_push_credential_profiles (
    id                  SERIAL PRIMARY KEY,
    name                VARCHAR(120) NOT NULL,
    os_type             VARCHAR(20)  NOT NULL,   -- 'windows' | 'linux'
    auth_type           VARCHAR(20)  NOT NULL,   -- 'domain' | 'local' | 'linux'
    domain              VARCHAR(120),
    username            VARCHAR(120) NOT NULL,
    password_encrypted  TEXT NOT NULL,
    created_by          UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS agent_push_jobs (
    id                        SERIAL PRIMARY KEY,
    os_type                   VARCHAR(20) NOT NULL,
    location_id               INTEGER NOT NULL REFERENCES agent_push_locations(id),
    credential_profile_id     INTEGER REFERENCES agent_push_credential_profiles(id) ON DELETE SET NULL,
    adhoc_domain              VARCHAR(120),
    adhoc_username            VARCHAR(120),
    adhoc_password_encrypted  TEXT,
    force_reinstall           BOOLEAN NOT NULL DEFAULT FALSE,
    status                    VARCHAR(20) NOT NULL DEFAULT 'pending',
    created_by                UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS agent_push_job_targets (
    id                          SERIAL PRIMARY KEY,
    job_id                      INTEGER NOT NULL REFERENCES agent_push_jobs(id) ON DELETE CASCADE,
    ip_or_host                  VARCHAR(255) NOT NULL,
    status                      VARCHAR(20) NOT NULL DEFAULT 'pending',
    log_output                  TEXT NOT NULL DEFAULT '',
    started_at                  TIMESTAMPTZ,
    finished_at                 TIMESTAMPTZ,
    override_domain             VARCHAR(120),
    override_username           VARCHAR(120),
    override_password_encrypted TEXT,
    override_location_id        INTEGER REFERENCES agent_push_locations(id),
    override_os_type            VARCHAR(20)
);
CREATE INDEX IF NOT EXISTS idx_agent_push_job_targets_job ON agent_push_job_targets(job_id);

CREATE TABLE IF NOT EXISTS agent_push_config (
    id                  INTEGER PRIMARY KEY DEFAULT 1,
    job_retention_days  INTEGER NOT NULL DEFAULT 30,
    updated_by          UUID REFERENCES users(id) ON DELETE SET NULL,
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO agent_push_config (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
