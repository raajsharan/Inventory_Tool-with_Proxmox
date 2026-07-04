-- =====================================================================
-- VMware Discovery Schema
-- Run after main schema.sql
-- =====================================================================

-- Saved vCenter/ESXi hosts with encrypted credentials
CREATE TABLE IF NOT EXISTS vmware_hosts (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    host                VARCHAR(255) UNIQUE NOT NULL,
    username            VARCHAR(255) NOT NULL,
    password_encrypted  TEXT NOT NULL,
    port                INT NOT NULL DEFAULT 443,
    verify_ssl          BOOLEAN NOT NULL DEFAULT FALSE,
    interval_minutes    INT NOT NULL DEFAULT 60,
    scheduler_enabled   BOOLEAN NOT NULL DEFAULT FALSE,
    last_discovery_at   TIMESTAMPTZ,
    last_vm_count       INT,
    is_running          BOOLEAN NOT NULL DEFAULT FALSE,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_vmware_hosts_host ON vmware_hosts(host);

-- Discovery run history (one record per triggered run)
CREATE TABLE IF NOT EXISTS vmware_discovery_runs (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    host_id         UUID NOT NULL REFERENCES vmware_hosts(id) ON DELETE CASCADE,
    source_host     VARCHAR(255) NOT NULL,
    vm_count        INT,
    status          VARCHAR(16) NOT NULL DEFAULT 'running',  -- running | success | error
    error_message   TEXT,
    run_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_vmware_runs_host    ON vmware_discovery_runs(host_id);
CREATE INDEX IF NOT EXISTS idx_vmware_runs_run_at  ON vmware_discovery_runs(run_at);

-- VMs discovered per run (keep all runs; latest resolved in queries)
CREATE TABLE IF NOT EXISTS vmware_discovered_vms (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    run_id                  UUID NOT NULL REFERENCES vmware_discovery_runs(id) ON DELETE CASCADE,
    host_id                 UUID NOT NULL REFERENCES vmware_hosts(id) ON DELETE CASCADE,
    source_host             VARCHAR(255) NOT NULL,
    name                    VARCHAR(255),
    hostname                VARCHAR(255),
    ips                     TEXT[],
    esxi_host_name          VARCHAR(255),
    esxi_host_ip            VARCHAR(255),
    os_type                 VARCHAR(255),
    os_version              TEXT,
    macs                    TEXT[],
    created_date            VARCHAR(64),
    power_state             VARCHAR(32),
    tools_status            VARCHAR(64),
    num_cpu                 INT,
    memory_mb               INT,
    storage_committed_gb    VARCHAR(16),
    storage_uncommitted_gb  VARCHAR(16),
    datastores              TEXT[],
    snapshot_count          INT DEFAULT 0,
    snapshot_oldest         VARCHAR(64),
    discovered_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_vmware_vms_run    ON vmware_discovered_vms(run_id);
CREATE INDEX IF NOT EXISTS idx_vmware_vms_host   ON vmware_discovered_vms(host_id);
CREATE INDEX IF NOT EXISTS idx_vmware_vms_source ON vmware_discovered_vms(source_host);
CREATE INDEX IF NOT EXISTS idx_vmware_vms_name   ON vmware_discovered_vms(name);
