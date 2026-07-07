#!/usr/bin/env bash
# One-command deploy: pull → build frontend → restart backend → verify.
# Usage (from anywhere):  bash /path/to/project/deploy/update.sh
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SERVICE="${SERVICE:-inventory-backend}"
cd "$PROJECT_DIR"

echo "==> Project: $PROJECT_DIR"

echo "==> Pulling latest code"
git pull --ff-only

echo "==> Building frontend"
(cd frontend && npm run build)

echo "==> Restarting $SERVICE"
sudo systemctl restart "$SERVICE"
sleep 3

echo "==> Service state: $(sudo systemctl is-active "$SERVICE")"
echo "==> Startup log:"
sudo journalctl -u "$SERVICE" -n 12 --no-pager | grep -E "ensure-schema|listening|error" || true

DEPLOYED="$(git rev-parse --short HEAD)"
LIVE="$(curl -s --max-time 5 http://localhost:4000/health | grep -o '"commit":"[^"]*"' | cut -d'"' -f4 || true)"
echo ""
echo "==> Repo commit:    $DEPLOYED"
echo "==> Backend serves: ${LIVE:-unreachable}"
if [ "$DEPLOYED" = "$LIVE" ]; then
  echo "==> ✔ Deploy verified — backend is running the pulled commit."
else
  echo "==> ✖ MISMATCH — the running backend is NOT the pulled commit. Check the service unit paths."
  exit 1
fi
echo "Done. Hard-refresh the browser (Ctrl+Shift+R) to pick up the new frontend bundle."
