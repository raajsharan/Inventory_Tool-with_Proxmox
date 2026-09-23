#!/usr/bin/env bash
# Ubuntu setup helper — run on a fresh Ubuntu 22.04+ server as a sudo-capable user.
# Usage:  bash deploy/setup.sh
set -euo pipefail

PROJECT_DIR="${PROJECT_DIR:-/opt/inventory}"
DB_NAME="${DB_NAME:-inventory_db}"
DB_USER="${DB_USER:-inventory_user}"
DB_PASSWORD="${DB_PASSWORD:-$(openssl rand -hex 16)}"

echo "==> Installing system packages"
sudo apt update
sudo apt install -y curl ca-certificates gnupg nginx postgresql postgresql-contrib

if ! command -v node >/dev/null 2>&1; then
  echo "==> Installing Node.js 20"
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo apt install -y nodejs
fi

echo "==> Creating PostgreSQL user + database"
sudo -u postgres psql -v ON_ERROR_STOP=1 <<EOF
DO \$\$
BEGIN
   IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '${DB_USER}') THEN
      CREATE ROLE ${DB_USER} LOGIN PASSWORD '${DB_PASSWORD}';
   END IF;
END\$\$;
SELECT 'CREATE DATABASE ${DB_NAME} OWNER ${DB_USER}'
 WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = '${DB_NAME}')\gexec
GRANT ALL PRIVILEGES ON DATABASE ${DB_NAME} TO ${DB_USER};
EOF

echo "==> Loading schema + seed"
sudo -u postgres psql -d "${DB_NAME}" -f "${PROJECT_DIR}/db/schema.sql"
sudo -u postgres psql -d "${DB_NAME}" -f "${PROJECT_DIR}/db/seed.sql"

echo "==> Preparing backend"
cd "${PROJECT_DIR}/backend"
if [ ! -f .env ]; then
  cp .env.example .env
  ENC_KEY=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
  JWT_SEC=$(openssl rand -hex 32)
  sed -i "s|^DB_PASSWORD=.*|DB_PASSWORD=${DB_PASSWORD}|" .env
  sed -i "s|^JWT_SECRET=.*|JWT_SECRET=${JWT_SEC}|" .env
  sed -i "s|^ENCRYPTION_KEY=.*|ENCRYPTION_KEY=${ENC_KEY}|" .env
fi
npm ci --omit=dev
node scripts/seedUsers.js

echo "==> Building frontend"
cd "${PROJECT_DIR}/frontend"
[ -f .env ] || cp .env.example .env
npm ci
npm run build

echo "==> Installing systemd service"
sudo mkdir -p /var/log/inventory
sudo chown www-data:www-data /var/log/inventory
sudo cp "${PROJECT_DIR}/deploy/inventory-backend.service" /etc/systemd/system/
sudo chown -R www-data:www-data "${PROJECT_DIR}/backend"
sudo systemctl daemon-reload
sudo systemctl enable --now inventory-backend

echo "==> Allowing the backend to send ICMP (ping checks)"
# The service runs as www-data with NoNewPrivileges=true, which blocks
# /usr/bin/ping from picking up its cap_net_raw file capability — every ping
# check then fails with "socket: Operation not permitted" against hosts that
# are perfectly reachable from a root shell. Permitting unprivileged ICMP
# datagram sockets for the service's own gid is the narrow fix: it needs no
# capability grant to the Node process and leaves the hardening in place.
WWW_GID=$(id -g www-data)
echo "net.ipv4.ping_group_range = ${WWW_GID} ${WWW_GID}" \
  | sudo tee /etc/sysctl.d/99-inventory-ping.conf >/dev/null
sudo sysctl --system >/dev/null

echo "==> Configuring nginx"
sudo cp "${PROJECT_DIR}/deploy/nginx-inventory.conf" /etc/nginx/sites-available/inventory
sudo ln -sf /etc/nginx/sites-available/inventory /etc/nginx/sites-enabled/inventory
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx

echo "==================================================================="
echo "  Inventory Tool deployed."
echo "  URL:        http://$(hostname -I | awk '{print $1}')/"
echo "  Login:      admin@example.com / Admin@123  (CHANGE IMMEDIATELY)"
echo "  DB password (saved to backend/.env): ${DB_PASSWORD}"
echo "==================================================================="
