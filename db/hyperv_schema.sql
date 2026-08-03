-- Microsoft Hyper-V discovery tables
-- Credentials are stored encrypted; discovery uses WinRM (WS-Management over HTTP/HTTPS).

CREATE TABLE IF NOT EXISTS hyperv_hosts (
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
  -- last_discovery_at/last_vm_count are only set on a SUCCESSFUL run — these
  -- track the outcome of the most recent attempt (success or failure) so a
  -- host that fails every run doesn't look identical to one never triggered.
  last_status       VARCHAR(20),
  last_error        TEXT,
  last_attempt_at   TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS hyperv_discovery_runs (
  id            SERIAL PRIMARY KEY,
  host_id       INT NOT NULL REFERENCES hyperv_hosts(id) ON DELETE CASCADE,
  source_host   VARCHAR(255),
  status        VARCHAR(20) NOT NULL DEFAULT 'running',
  vm_count      INT DEFAULT 0,
  error_message TEXT,
  run_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_hyperv_runs_host ON hyperv_discovery_runs(host_id);

CREATE TABLE IF NOT EXISTS hyperv_discovered_vms (
  id              SERIAL PRIMARY KEY,
  run_id          INT NOT NULL REFERENCES hyperv_discovery_runs(id) ON DELETE CASCADE,
  host_id         INT NOT NULL REFERENCES hyperv_hosts(id) ON DELETE CASCADE,
  source_host     VARCHAR(255),
  vm_id           VARCHAR(255),
  name            VARCHAR(255),
  hostname        VARCHAR(255),      -- guest OS computer name (Win32_ComputerSystem)
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
);

CREATE INDEX IF NOT EXISTS idx_hyperv_vms_run  ON hyperv_discovered_vms(run_id);
CREATE INDEX IF NOT EXISTS idx_hyperv_vms_host ON hyperv_discovered_vms(host_id);
