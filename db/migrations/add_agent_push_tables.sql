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
-- Targets are picked from existing Assets/Ext. Assets records — like
-- Test Deploy and Software Status — rather than typed in. Credentials
-- are resolved fresh from each asset record's own asset_password_encrypted
-- at push time (see agentPushService.resolveAssetTarget()), never
-- duplicated into these tables.
--
-- This is documentation only — applied automatically and idempotently by
-- backend/src/bootstrap/ensureSchema.js on every server startup. Running
-- this file manually is optional.
-- =====================================================================

CREATE TABLE IF NOT EXISTS agent_push_locations (
    id           SERIAL PRIMARY KEY,
    name         VARCHAR(255) NOT NULL UNIQUE,
    folder_name  VARCHAR(255) NOT NULL UNIQUE,
    notes        TEXT,
    created_by   UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS agent_push_jobs (
    id                        SERIAL PRIMARY KEY,
    force_reinstall           BOOLEAN NOT NULL DEFAULT FALSE,
    status                    VARCHAR(20) NOT NULL DEFAULT 'pending',
    created_by                UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- source/ip_address identify the asset record to re-resolve credentials
-- from at push time; vm_name/os_type/location are a display-only snapshot
-- taken at job-creation time so the Job Detail table doesn't need a join
-- back to a (possibly since-changed or deleted) asset record.
CREATE TABLE IF NOT EXISTS agent_push_job_targets (
    id                          SERIAL PRIMARY KEY,
    job_id                      INTEGER NOT NULL REFERENCES agent_push_jobs(id) ON DELETE CASCADE,
    source                      VARCHAR(32) NOT NULL,
    ip_address                  VARCHAR(64) NOT NULL,
    vm_name                     VARCHAR(255),
    os_type                     VARCHAR(128),
    location                    VARCHAR(255),
    status                      VARCHAR(20) NOT NULL DEFAULT 'pending',
    log_output                  TEXT NOT NULL DEFAULT '',
    started_at                  TIMESTAMPTZ,
    finished_at                 TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_agent_push_job_targets_job ON agent_push_job_targets(job_id);

CREATE TABLE IF NOT EXISTS agent_push_config (
    id                  INTEGER PRIMARY KEY DEFAULT 1,
    job_retention_days  INTEGER NOT NULL DEFAULT 30,
    updated_by          UUID REFERENCES users(id) ON DELETE SET NULL,
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO agent_push_config (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
