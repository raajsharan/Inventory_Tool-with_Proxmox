# Infrastructure Inventory Management Tool — with Proxmox

Enterprise-grade IT asset inventory platform built with React (Ant Design 5), Node.js/Express, and PostgreSQL. Integrates live VMware vSphere and Proxmox VE discovery, Tenable vulnerability data, Nessus Agent status tracking, ManageEngine Endpoint Central, and a full VMware-to-Proxmox migration tracker — all in one unified dashboard.

---

## Features

### Asset Management
- **Four Inventory Types** — Asset Inventory, Ext. Asset Inventory, Beijing Assets, Physical & ESXi Servers
- **25+ Fields per Asset** — VM name, hostname, IP, MAC address (required), OS type/version, department, location, asset tag, server status, patching details, and more
- **Physical & ESXi Servers** — Dedicated hardware fields: server model, CPU cores, RAM (GB), total disks, rack number, server position; linked Server Models catalogue
- **iDRAC Section** — Serial Number, OME Status, and iDRAC IP Address shown only when iDRAC Enabled is toggled on
- **Encrypted Credentials** — Asset passwords stored with AES-256-GCM; per-user `can_view_passwords` flag enforced at API level
- **Excel Import / Export** — Smart import with preview and diff (Create / Merge / Errors filter), downloadable template, row-by-row validation
- **Field Customization** — Admins can rename labels, reorder fields, change input types, and add custom extra fields per inventory page
- **Recycle Bin** — Soft-delete with restore capability
- **Bulk Actions** — Select multiple assets for bulk status update, tag assign, or delete
- **Global Search** — Cross-inventory search across all four asset types simultaneously

### Decommission Lifecycle
- **Decommissioned Page** — Separate page listing all decommissioned assets across all four inventory sources
- **Permanent Decommission Log** — Immutable audit record: who decommissioned what, when, from where, and why; survives asset deletion
- **Tag & IP Release** — Asset tag and IP address freed for reuse on decommission; reclaimed on reactivation
- **Reactivation** — One-click reactivate from the Decommissioned page; log row closed with reactivated_by / reactivated_at

### VMware-to-Proxmox Migration Tracker
- **Project-based** — Multiple migration projects, each with its own tab configuration and progress
- **Five tracking tabs per project:**
  - **Hosts** — Track host-level migration stages (VMs Vacate, Proxmox Install, VM Migration Back) with per-stage selects, iDRAC credential vault, license expiry highlighting
  - **Bomgar VMs** — Per-VM migration status tracking with powerstate, IP, OS, cluster, datacenter columns
  - **Security VMs** — Dedicated tab for security-critical VMs with the same status workflow
  - **Standalone ESXi** — VMs on unmanaged ESXi hosts with a prominent "not centrally managed" warning
  - **Custom Tabs** — Admin-defined tabs linked to any vCenter group; fully configurable columns and hidden fields
- **Custom Fields** — Per-project custom field definitions (text, textarea, number, boolean, dropdown, date) displayed as inline-editable columns on any tab
- **Inline Editing** — Status selects, notes, and custom fields edited directly in the table; changes saved on change
- **Column Management** — Show/hide and drag-to-reorder columns per tab; preferences persisted in localStorage
- **Summary Cards** — Live progress counters (Total, Migrated, In Progress, Blocked, Pending, Powered Off) on every tab
- **Overview Tab** — Overall progress bar, host summary, VMs-by-source breakdown, and hosts-by-datacenter table
- **Filters & Search** — Per-column filter dropdowns and free-text search on every tab
- **CSV Export** — Export any tab as CSV
- **Excel Import** — Import from spreadsheet; sheet names map to tabs (Hosts, Bomgar VMs, Security VMs, etc.)

### ManageEngine Endpoint Central
- **Agent Status** — Live agent list from ME Endpoint Central with health and status per device
- **Software Inventory** — Software deployment list pulled from the EC API
- **API Key Auth** — Classic API key configuration
- **Credential Login + Two-Factor Authentication (TOTP)** — Alternative login mode using username/password + 6-digit TOTP code (compatible with any TOTP app); session token stored in DB and reused until expiry
- **Auto-discovery** — Configurable server URL with automatic API path detection

### Microsoft Teams Notifications
- **Incoming Webhook integration** — Posts Adaptive Cards to any Teams channel via a Workflows webhook URL
- **Per-event toggles** — Enable/disable independently:
  - New asset registered (across all four inventory sources)
  - Asset updated
  - Asset decommissioned / reactivated
  - Migration status changed (all tracker tabs)
- **Fire-and-forget** — Notifications never block or slow down API responses
- **Test button** — Send a test card to verify the webhook before saving
- **Admin config page** — Admin → Teams Notifications

### VM Discovery
- **VMware vSphere** — Discover VMs from multiple vCenter/ESXi hosts; view dashboards, drift detection, ESXi topology, snapshots, stale VMs, MAC lookup
- **Proxmox VE** — Discover QEMU VMs and LXC containers across nodes; view topology, snapshots, drift, stale VMs
- **Add to Inventory** — One-click push of any discovered VM into Ext. Asset Inventory with pre-filled hostname, IP, MAC address, OS, hosted IP

### Software Services
- **ManageEngine Endpoint Central** — Agent list, software inventory; API key or credential+TOTP auth
- **Nessus Agent Status** — Nessus agent install state per asset with Linux curl install support
- **Tenable Report** — Three-tab report: Matched (in both inventories and Tenable), Not in Tenable, Tenable Only. Stat cards, search, source filter, CSV export; admin import drawer for Tenable Excel files. Covers all 4 inventory sources.

### Reports
- **Weekly Report** — Configurable weekly compliance report with inventory totals, status breakdowns, and extended inventory summary; "NA" and "Not in Scope" assets correctly excluded from totals

### Data Health & Reconciliation
- **Data Health** — Dashboard surfacing data quality issues: missing IPs, duplicate MACs, missing asset tags, stale records
- **Reconcile** — Cross-reference inventory against live discovery sources to find drift

### Administration
- **Role-Based Access Control** — Superadmin, Admin, Asset Manager, Viewer; custom roles; per-page access control
- **User Page Control** — Per-user toggle for password visibility and individual page access overrides
- **Superadmin Account** — Hidden from all non-superadmin users at every API layer; full god-mode access
- **Nav Order** — Drag-and-drop sidebar menu reordering stored in localStorage
- **Audit Logs** — Every create / update / delete / import / export / login / view-password event recorded
- **Backup & Restore** — PostgreSQL dump + CSV export per table; scheduled or manual; restore from upload or history
- **Branding** — Custom logo, app name, colour scheme
- **Compliance Config** — Admin-controlled compliance thresholds and weekly report customisation (day of week, included sections)
- **Dropdown Master** — Centralised dropdown values for OS type, location, server status, patching type, etc.
- **Server Models Catalogue** — Shared library of server manufacturer/model entries referenced by Physical ESXi server records
- **Department Tag Ranges** — Controlled asset tag allocation per department
- **Teams Notifications** — Webhook URL and per-event toggle management
- **Swagger API Docs** — `/api/docs`

---

## Stack

| Layer      | Technology                                          |
|------------|-----------------------------------------------------|
| Frontend   | React 18 + Vite + Ant Design 5 + React Router 6    |
| Backend    | Node.js 20 + Express 4 + JWT + bcrypt               |
| Database   | PostgreSQL 18 (pg driver, JSONB)                    |
| Files      | ExcelJS (Excel parse/generate), multer (uploads)    |
| SSH        | node-ssh (remote agent install)                     |
| Crypto     | AES-256-GCM via Node.js `crypto` module             |
| Notifications | Node.js built-in `https` → Teams Incoming Webhook |
| Docs       | swagger-ui-express                                  |
| Process    | systemd (production)                                |
| Proxy      | nginx (production)                                  |

---

## Project Layout

```
Inventory_Tool - with Proxmox/
├── backend/
│   ├── server.js                      # Express entry point + static SPA serving
│   └── src/
│       ├── bootstrap/
│       │   ├── ensureSchema.js        # Idempotent DDL — all tables/columns created on startup
│       │   └── ensureSuperadmin.js    # Superadmin bootstrap on startup
│       ├── config/                    # DB pool, Swagger spec
│       ├── controllers/               # Route handlers
│       │   ├── assetController.js
│       │   ├── extAssetController.js
│       │   ├── beijingAssetController.js
│       │   ├── physicalEsxiController.js
│       │   ├── migrationController.js      # Migration Tracker CRUD
│       │   ├── teamsNotificationController.js  # Teams webhook config
│       │   ├── endpointCentralController.js    # ME EC agent + software + auth
│       │   ├── tenableController.js            # Tenable report + import
│       │   ├── vmwareController.js             # VMware discovery
│       │   ├── proxmoxController.js            # Proxmox discovery
│       │   ├── softwareStatusController.js
│       │   ├── nessusStatusController.js
│       │   ├── userController.js
│       │   ├── customRolesController.js
│       │   └── ...
│       ├── middleware/
│       │   ├── auth.js                # authenticate / authorize / requirePageAccess / requirePasswordAccess
│       │   ├── errorHandler.js
│       │   └── validate.js
│       ├── routes/                    # Express routers (one per resource)
│       │   ├── migrationRoutes.js
│       │   ├── teamsNotificationRoutes.js
│       │   ├── endpointCentralRoutes.js
│       │   └── ...
│       ├── services/                  # Business logic
│       │   ├── migrationService.js         # Migration Tracker queries + import
│       │   ├── teamsNotificationService.js # Adaptive Card sender + config CRUD
│       │   ├── endpointCentralService.js   # ME EC API + credential/TOTP auth
│       │   ├── decommissionService.js      # Decommission lifecycle (shared)
│       │   ├── inventoryFieldsService.js   # Dynamic field/group registry
│       │   ├── vmwareService.js            # vSphere API
│       │   ├── proxmoxService.js           # Proxmox API
│       │   ├── vmwareSchedulerService.js
│       │   ├── proxmoxSchedulerService.js
│       │   ├── backupService.js
│       │   └── ...
│       └── utils/
│           ├── crypto.js              # AES-256-GCM encrypt/decrypt
│           ├── sshVerify.js           # SSH agent install helpers
│           └── winInstall.js
├── frontend/
│   └── src/
│       ├── components/
│       │   ├── Layout/AppLayout.jsx        # Sidebar nav
│       │   └── AddToInventoryModal.jsx     # Push discovered VM to Ext. Inventory
│       └── pages/
│           ├── Assets/                     # AssetForm, AssetList, AssetView
│           ├── MigrationTracker/           # Overview, Hosts, Bomgar VMs, Security VMs,
│           │   └── components/             # Standalone ESXi, Custom Tabs, shared helpers
│           ├── EndpointCentral/            # ME EC agent list, software tab, config modal
│           ├── VMwareDiscovery/            # VM list, dashboard, drift, topology, snapshots
│           ├── ProxmoxDiscovery/           # PVE list, dashboard, drift, topology, snapshots
│           ├── TenableReport/              # 3-tab report, import drawer
│           ├── Decommissioned/             # Decommissioned assets + reactivate
│           ├── NessusStatus/
│           ├── SoftwareStatus/
│           └── Admin/
│               ├── TeamsNotifications.jsx  # Teams webhook config
│               ├── MigrationConfig.jsx     # Migration project + tab configuration
│               ├── ComplianceConfig.jsx    # Compliance thresholds + weekly report settings
│               ├── ServerModels.jsx        # Server models catalogue
│               ├── DataHealth.jsx
│               ├── Users.jsx
│               ├── Roles.jsx
│               ├── NavOrder.jsx
│               ├── UserPageControl.jsx
│               └── ...
├── db/
│   ├── schema.sql                     # Core tables
│   ├── vmware_schema.sql              # VMware discovery tables
│   ├── proxmox_schema.sql             # Proxmox discovery tables
│   ├── tenable_schema.sql             # tenable_imports + tenable_assets
│   └── vmware_asset_edits.sql         # VM asset editor audit table
└── README.md
```

> **Note:** All table/column additions are handled automatically by `ensureSchema.js` on backend startup — no manual SQL migration scripts needed for upgrades.

---

## Database Setup

Apply schemas in order (first-time setup only):

```bash
psql -U postgres -d inventory_new -f db/schema.sql
psql -U postgres -d inventory_new -f db/vmware_schema.sql
psql -U postgres -d inventory_new -f db/proxmox_schema.sql
psql -U postgres -d inventory_new -f db/tenable_schema.sql
psql -U postgres -d inventory_new -f db/vmware_asset_edits.sql
```

For upgrades, simply restart the backend — `ensureSchema.js` runs all `IF NOT EXISTS` / `IF EXISTS` DDL automatically.

---

## Environment Variables

Copy `backend/.env.example` to `backend/.env` and fill in:

```env
# Database
DATABASE_URL=postgresql://postgres:your_password@localhost:5432/inventory_new
DB_PASSWORD=your_password

# Auth
JWT_SECRET=<generate: openssl rand -hex 32>
JWT_EXPIRES_IN=12h

# Encryption (AES-256-GCM) — must be 64 hex chars (32 bytes)
ENCRYPTION_KEY=<generate: openssl rand -hex 32>

# CORS (comma-separated; omit for localhost-only default)
CORS_ORIGIN=http://localhost:4000,http://localhost:5173

# Optional: superadmin bootstrap (creates account on first startup if set)
SUPERADMIN_EMAIL=superadmin@example.com
SUPERADMIN_PASSWORD=Sys@2026!

# Backup
PG_DUMP_PATH=/usr/bin/pg_dump
CSV_BACKUP_DIR=/var/backups/inventory

NODE_ENV=production
PORT=4000
```

> **Never commit `.env`** — it is listed in `.gitignore`. Rotate `JWT_SECRET` and `ENCRYPTION_KEY` periodically.

---

## Local Development

```bash
# 1. Backend
cd backend
cp .env.example .env   # fill in DB creds
npm install
npm run dev            # http://localhost:4000

# 2. Frontend (new terminal)
cd frontend
npm install
npm run dev            # http://localhost:5173  (Vite proxies /api/* → 4000)
```

### Production build (single port)

The backend serves the compiled frontend as static files:

```bash
cd frontend && npm run build   # outputs to frontend/dist
cd ../backend && node server.js  # serves both API and SPA on :4000
```

---

## Ubuntu Server Setup

### 1. Prerequisites

```bash
sudo apt update
sudo apt install -y curl ca-certificates gnupg nginx postgresql

# Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
```

### 2. PostgreSQL

```bash
sudo -u postgres psql <<EOF
CREATE USER inventory_user WITH PASSWORD 'strong-password-here';
CREATE DATABASE inventory_new OWNER inventory_user;
GRANT ALL PRIVILEGES ON DATABASE inventory_new TO inventory_user;
EOF

sudo -u postgres psql -d inventory_new -f /opt/inventory/db/schema.sql
sudo -u postgres psql -d inventory_new -f /opt/inventory/db/vmware_schema.sql
sudo -u postgres psql -d inventory_new -f /opt/inventory/db/proxmox_schema.sql
sudo -u postgres psql -d inventory_new -f /opt/inventory/db/tenable_schema.sql
sudo -u postgres psql -d inventory_new -f /opt/inventory/db/vmware_asset_edits.sql
```

### 3. Deploy

```bash
sudo mkdir -p /opt/inventory && sudo chown $USER /opt/inventory
git clone https://github.com/raajsharan/Inventory_Tool-with_Proxmox.git /opt/inventory

cd /opt/inventory/backend && cp .env.example .env && nano .env
npm ci --omit=dev

cd /opt/inventory/frontend && npm ci && npm run build
```

### 4. systemd

```bash
sudo cp /opt/inventory/deploy/inventory-backend.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now inventory-backend
```

### 5. nginx (optional — if not using integrated static serving)

```bash
sudo cp /opt/inventory/deploy/nginx-inventory.conf /etc/nginx/sites-available/inventory
sudo ln -s /etc/nginx/sites-available/inventory /etc/nginx/sites-enabled/inventory
sudo nginx -t && sudo systemctl reload nginx
```

For HTTPS: `sudo certbot --nginx -d your.domain.com`

---

## Roles & Access

| Role              | Access                                                                           |
|-------------------|----------------------------------------------------------------------------------|
| **Superadmin**    | Full access to everything; hidden from all other users; cannot be deleted        |
| **Admin**         | All CRUD, user management, dropdowns, roles, audit, backup, field customisation, Teams notifications |
| **Asset Manager** | Create / edit / delete / import / export assets; cannot manage users or roles    |
| **Viewer**        | Read-only access to assets and dashboard                                         |
| Custom roles      | Admins can define custom roles with page-level permissions                       |

Per-user overrides (set in **User Page Control**):
- `can_view_passwords` — allow/deny revealing encrypted asset passwords
- Individual page access toggles per user (overrides role defaults)

---

## API Highlights

### Auth
| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/auth/login` | Login, returns JWT |
| GET  | `/api/auth/me` | Current user profile |
| POST | `/api/auth/me/change-password` | Change password (rate-limited: 5/15 min) |

### Asset Inventories (same pattern for `/assets`, `/ext-assets`, `/beijing-assets`, `/physical-esxi`)
| Method | Path | Purpose |
|--------|------|---------|
| GET    | `/api/assets` | List with search / filter / pagination |
| POST   | `/api/assets` | Create asset |
| GET    | `/api/assets/:id` | Get asset |
| PUT    | `/api/assets/:id` | Update asset |
| DELETE | `/api/assets/:id` | Soft-delete |
| GET    | `/api/assets/:id/password` | Reveal encrypted password (requires `can_view_passwords`) |
| POST   | `/api/assets/import` | Excel import |
| GET    | `/api/assets/export` | Export filtered CSV |

### Migration Tracker
| Method | Path | Purpose |
|--------|------|---------|
| GET    | `/api/migration/overview` | Overall progress + VM/host summary |
| GET    | `/api/migration/hosts` | Host list (paginated, filtered) |
| PATCH  | `/api/migration/hosts/:id` | Update host stage/status |
| GET    | `/api/migration/bomgar-vms` | Bomgar VM list |
| PATCH  | `/api/migration/bomgar-vms/:id` | Update migration status |
| GET    | `/api/migration/security-vms` | Security VM list |
| PATCH  | `/api/migration/security-vms/:id` | Update migration status |
| GET    | `/api/migration/standalone-esxi` | Standalone ESXi VM list |
| PATCH  | `/api/migration/standalone-esxi/:id` | Update migration status |
| GET    | `/api/migration/custom-vms` | Custom tab VM list |
| PATCH  | `/api/migration/custom-vms/:id` | Update migration status |
| POST   | `/api/migration/import` | Excel import (multi-sheet) |

### ManageEngine Endpoint Central
| Method | Path | Purpose |
|--------|------|---------|
| GET    | `/api/endpoint-central` | Agent list |
| GET    | `/api/endpoint-central/software` | Software inventory |
| GET    | `/api/endpoint-central/config` | Current config (password masked) |
| PUT    | `/api/endpoint-central/config` | Save config (API key or credential mode) |
| POST   | `/api/endpoint-central/test` | Test connection |
| POST   | `/api/endpoint-central/login` | Credential login (returns OTP required flag if 2FA enabled) |
| POST   | `/api/endpoint-central/login/otp` | Submit TOTP code, stores session token |

### Teams Notifications
| Method | Path | Purpose |
|--------|------|---------|
| GET    | `/api/teams-notification` | Get config |
| PUT    | `/api/teams-notification` | Save webhook URL and event toggles |
| POST   | `/api/teams-notification/test` | Send test Adaptive Card to Teams |

### VM Discovery
| Method | Path | Purpose |
|--------|------|---------|
| GET  | `/api/vmware/vms` | List discovered VMware VMs |
| GET  | `/api/vmware/vms/export` | Export VM list as CSV |
| GET  | `/api/proxmox/vms` | List discovered Proxmox VMs / containers |
| GET  | `/api/proxmox/vms/export` | Export Proxmox inventory as CSV |

### Software Services
| Method | Path | Purpose |
|--------|------|---------|
| GET  | `/api/software-status` | ManageEngine status per asset |
| GET  | `/api/nessus-status` | Nessus agent status per asset |
| GET  | `/api/tenable/report` | Full Tenable report (matched / not-in / tenable-only) |
| POST | `/api/tenable/import` | Upload Tenable Excel file (admin) |

### Administration
| Method | Path | Purpose |
|--------|------|---------|
| GET/PUT | `/api/admin/field-config/:pageKey` | Field customisation per inventory page |
| GET  | `/api/users` | User list |
| GET  | `/api/roles` | Role list |
| GET  | `/api/audit` | Audit log |
| GET  | `/api/dropdowns` | All dropdown values |
| GET/POST | `/api/backup/csv` | Backup / restore CSV per table |
| GET  | `/api/server-models` | Server models catalogue |
| GET/PUT | `/api/compliance-config` | Compliance thresholds and report settings |
| GET  | `/api/decommissioned` | Decommissioned asset log |

Full interactive schema: `/api/docs`

---

## Teams Notifications Setup

1. In Microsoft Teams, open a channel → **Apps** → search **Incoming Webhook** → **Add to a channel**
2. Name it (e.g. "Inventory Alerts") and copy the webhook URL
3. In the Inventory Tool: **Admin → Teams Notifications**
4. Paste the URL, toggle **Enable Teams notifications**, choose which events to fire, and click **Save Configuration**
5. Click **Send Test Notification** to confirm the card appears in Teams

Notifications are sent as Adaptive Cards with colour-coded status (green = completed/good, amber = in-progress/pending, red = blocked/decommissioned).

---

## ME Endpoint Central — Two-Factor Auth Setup

If your ME EC instance requires 2FA:

1. In **Admin → Endpoint Central Config**, switch auth mode to **Login with Credentials**
2. Enter username and password
3. Click **Login** — if 2FA is required, a 6-digit code prompt appears
4. Enter the current TOTP code from your authenticator app
5. The session token is saved in the database and used for subsequent API calls

To rotate the session (e.g. after token expiry), repeat the Login flow from the config modal.

---

## Security

| Measure | Detail |
|---------|--------|
| **Password hashing** | bcrypt, 12 rounds |
| **Asset credential encryption** | AES-256-GCM (`backend/src/utils/crypto.js`) |
| **JWT** | HS256, signed with `JWT_SECRET`; configurable expiry |
| **Password access control** | `requirePasswordAccess` middleware DB-checks `can_view_passwords` flag per request |
| **CORS** | Restricted to explicit `CORS_ORIGIN` list; no wildcard |
| **Rate limiting** | Login: 20 req/15 min; password change: 5 req/15 min |
| **Password strength** | Min 8 chars, must include uppercase, lowercase, and a number |
| **File upload validation** | Multer `fileFilter` enforces MIME type + extension |
| **Input validation** | express-validator on every route |
| **Helmet** | HTTP security headers on all responses |
| **SQL injection** | All queries use parameterised `$n` placeholders |
| **Superadmin isolation** | Filtered from user lists, role lists, and page-control APIs for all non-superadmin requests |
| **Privilege escalation guard** | Non-superadmin users cannot assign the `superadmin` role |
| **Teams webhook** | URL stored in DB; never exposed to frontend; all calls are server-side only |
| **Error responses** | 500 errors return a generic message in production; details only in development |

---

## Upgrading

```bash
cd /opt/inventory
git pull

cd backend  && npm ci --omit=dev
cd ../frontend && npm ci && npm run build
sudo systemctl restart inventory-backend
```

Schema changes are applied automatically by `ensureSchema.js` on restart — no manual SQL required.

---

## License

Internal use.
