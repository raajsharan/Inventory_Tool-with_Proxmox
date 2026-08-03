-- Proxmox VE & Proxmox Datacenter Manager (PDM) discovery tables
-- Run: psql -U <db_user> -d <db_name> -f db/proxmox_schema.sql

CREATE TABLE IF NOT EXISTS proxmox_hosts (
  id                       SERIAL PRIMARY KEY,
  host                     VARCHAR(255) UNIQUE NOT NULL,
  host_type                VARCHAR(10)  NOT NULL DEFAULT 've',   -- 've' or 'pdm'
  username                 VARCHAR(255) NOT NULL,
  realm                    VARCHAR(50)  NOT NULL DEFAULT 'pam',  -- 'pam', 'pve', 'ldap'
  password_encrypted       TEXT,
  token_id                 VARCHAR(255),          -- API token: "user@realm!tokenid"
  token_secret_encrypted   TEXT,                  -- encrypted API token secret
  port                     INTEGER      NOT NULL DEFAULT 8006,
  verify_ssl               BOOLEAN      NOT NULL DEFAULT FALSE,
  interval_minutes         INTEGER      NOT NULL DEFAULT 60,
  scheduler_enabled        BOOLEAN      NOT NULL DEFAULT FALSE,
  last_discovery_at        TIMESTAMP,
  last_vm_count            INTEGER,
  is_running               BOOLEAN      NOT NULL DEFAULT FALSE,
  created_at               TIMESTAMP    NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMP    NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS proxmox_discovery_runs (
  id            SERIAL PRIMARY KEY,
  host_id       INTEGER      NOT NULL REFERENCES proxmox_hosts(id) ON DELETE CASCADE,
  source_host   VARCHAR(255) NOT NULL,
  status        VARCHAR(20)  NOT NULL DEFAULT 'running',   -- 'running', 'success', 'error'
  vm_count      INTEGER,
  error_message TEXT,
  run_at        TIMESTAMP    NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS proxmox_discovered_vms (
  id              SERIAL PRIMARY KEY,
  run_id          INTEGER      NOT NULL REFERENCES proxmox_discovery_runs(id) ON DELETE CASCADE,
  host_id         INTEGER      NOT NULL REFERENCES proxmox_hosts(id) ON DELETE CASCADE,
  source_host     VARCHAR(255),
  vmid            INTEGER,
  name            VARCHAR(255),
  hostname        VARCHAR(255),      -- guest OS hostname (QEMU guest agent / LXC config)
  vm_type         VARCHAR(10),       -- 'qemu' or 'lxc'
  node            VARCHAR(255),      -- Proxmox node name
  status          VARCHAR(50),       -- 'running', 'stopped', 'paused'
  cpu_count       INTEGER,
  memory_mb       INTEGER,
  disk_gb         NUMERIC(12,2),
  ips             TEXT[],
  macs            TEXT[],
  os_type         VARCHAR(255),
  uptime_seconds  BIGINT,
  is_template     BOOLEAN      DEFAULT FALSE,
  snapshot_count  INTEGER      DEFAULT 0,
  snapshot_oldest VARCHAR(100),
  tags            TEXT[],
  pool            VARCHAR(255),
  cluster         VARCHAR(255),      -- for PDM: which remote cluster the VM belongs to
  created_at      TIMESTAMP    NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS proxmox_discovered_nodes (
  id              SERIAL PRIMARY KEY,
  run_id          INTEGER      NOT NULL REFERENCES proxmox_discovery_runs(id) ON DELETE CASCADE,
  host_id         INTEGER      NOT NULL REFERENCES proxmox_hosts(id) ON DELETE CASCADE,
  source_host     VARCHAR(255),
  node            VARCHAR(255),      -- Proxmox node name
  status          VARCHAR(50),       -- 'online', 'offline', 'unknown'
  ip_address      VARCHAR(64),
  mac_address     VARCHAR(64),
  os_type         VARCHAR(100),
  os_version      VARCHAR(255),      -- pveversion string, e.g. "pve-manager/8.1.4/..."
  kernel_version  VARCHAR(255),
  cpu_model       VARCHAR(255),
  cpu_cores       INTEGER,
  cpu_sockets     INTEGER,
  memory_mb       INTEGER,
  uptime_seconds  BIGINT,
  vm_count        INTEGER      DEFAULT 0,
  snapshot_count  INTEGER      DEFAULT 0,
  created_at      TIMESTAMP    NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_proxmox_runs_host_id  ON proxmox_discovery_runs(host_id);
CREATE INDEX IF NOT EXISTS idx_proxmox_runs_status   ON proxmox_discovery_runs(status);
CREATE INDEX IF NOT EXISTS idx_proxmox_vms_run_id    ON proxmox_discovered_vms(run_id);
CREATE INDEX IF NOT EXISTS idx_proxmox_vms_host_id   ON proxmox_discovered_vms(host_id);
CREATE INDEX IF NOT EXISTS idx_proxmox_vms_node      ON proxmox_discovered_vms(node);
CREATE INDEX IF NOT EXISTS idx_proxmox_nodes_run_id  ON proxmox_discovered_nodes(run_id);
CREATE INDEX IF NOT EXISTS idx_proxmox_nodes_host_id ON proxmox_discovered_nodes(host_id);
CREATE INDEX IF NOT EXISTS idx_proxmox_nodes_node    ON proxmox_discovered_nodes(node);
