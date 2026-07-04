-- =====================================================================
-- VMware Asset Editor — local edit overrides
-- Run after vmware_schema.sql
-- =====================================================================

CREATE TABLE IF NOT EXISTS vmware_asset_edits (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_host VARCHAR(255) NOT NULL,
    vm_name     VARCHAR(255) NOT NULL,
    asset_name  VARCHAR(255),
    hostname    VARCHAR(255),
    ip_address  VARCHAR(255),
    os_type     VARCHAR(255),
    os_version  TEXT,
    notes       TEXT,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (source_host, vm_name)
);

CREATE INDEX IF NOT EXISTS idx_vmware_asset_edits_key
    ON vmware_asset_edits (source_host, vm_name);
