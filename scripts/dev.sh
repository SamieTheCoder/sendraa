#!/bin/zsh
# Starts the whole Sendraa dev stack: Postgres, migrations, the Cloudflare
# Tunnel (api-dev.sendraa.tech -> localhost:8787), the API and Expo.
# Ctrl+C stops everything it started.
#
#   pnpm dev                 # Expo on its default port
#   EXPO_PORT=6969 pnpm dev  # Expo on another port
set -e
ROOT=${0:A:h:h}
API="$ROOT/services/api"
MOBILE="$ROOT/apps/mobile"
LOGS="$ROOT/.dev-logs"
mkdir -p "$LOGS"

pids=()
cleanup() {
  echo "\nStopping…"
  for p in $pids; do kill $p 2>/dev/null || true; done
  wait 2>/dev/null
}
trap cleanup INT TERM EXIT

# 1. Docker and Postgres
if ! docker info >/dev/null 2>&1; then
  echo "Starting Docker Desktop…"
  open -a Docker
  for i in {1..60}; do docker info >/dev/null 2>&1 && break; sleep 2; done
  docker info >/dev/null 2>&1 || { echo "Docker did not start."; exit 1; }
fi
(cd "$API" && pnpm -s db:up >/dev/null)
echo "Postgres up."
for i in {1..20}; do (cd "$API" && pnpm -s migrate >"$LOGS/migrate.log" 2>&1) && break; sleep 2; done
echo "Migrations applied."

# 2. Tunnel and API (logs in .dev-logs/)
(cd "$API" && pnpm -s tunnel >"$LOGS/tunnel.log" 2>&1) & pids+=$!
(cd "$API" && pnpm -s start >"$LOGS/api.log" 2>&1) & pids+=$!

for i in {1..30}; do curl -sf -m 3 http://localhost:8787/health >/dev/null && break; sleep 1; done
curl -sf -m 3 http://localhost:8787/health >/dev/null && echo "API up:    http://localhost:8787" || { echo "API failed, see $LOGS/api.log"; exit 1; }
for i in {1..30}; do curl -sf -m 5 https://api-dev.sendraa.tech/health >/dev/null && break; sleep 1; done
curl -sf -m 5 https://api-dev.sendraa.tech/health >/dev/null && echo "Tunnel up: https://api-dev.sendraa.tech" || echo "Tunnel not answering yet, see $LOGS/tunnel.log"
echo "Logs:      $LOGS/{api,tunnel}.log\n"

# 3. Expo in the foreground, so its QR code and keys work
cd "$MOBILE"
npx expo start --clear ${EXPO_PORT:+--port $EXPO_PORT}
