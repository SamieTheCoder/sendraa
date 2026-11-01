#!/bin/sh
# Starts the dev Postgres. Opens Docker Desktop first if it is not running,
# because Postgres runs in Docker and Docker Desktop is often closed.
set -e
cd "$(dirname "$0")/.."

if ! docker info >/dev/null 2>&1; then
  echo "Docker is not running. Starting Docker Desktop…"
  open -a Docker
  i=0
  until docker info >/dev/null 2>&1; do
    i=$((i + 1))
    if [ "$i" -gt 60 ]; then
      echo "Docker Desktop did not start within 2 minutes. Open it manually, then run this again." >&2
      exit 1
    fi
    sleep 2
  done
  echo "Docker is running."
fi

docker compose -f docker-compose.dev.yml up -d --wait
