#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

log() {
  printf '[verify-resilience] %s\n' "$*"
}

run() {
  log "$*"
  "$@"
}

cd "$ROOT_DIR"

run bash -n \
  scripts/compose-health-watchdog.sh \
  scripts/local-recovery-drill.sh \
  scripts/server-auto-update.sh \
  scripts/server-health-check.sh \
  scripts/server-health-report.sh \
  scripts/experimental-dashboard.sh \
  scripts/backups/create-database-backup.sh \
  scripts/backups/record-offsite-backup.sh \
  scripts/test-compose-health-watchdog.sh \
  scripts/test-database-backup.sh \
  scripts/test-server-auto-update.sh \
  scripts/test-server-health-check.sh \
  scripts/test-server-health-report.sh \
  scripts/test-experimental-dashboard.sh \
  scripts/overnight-test.sh

run ./scripts/test-compose-health-watchdog.sh
run ./scripts/test-database-backup.sh
run ./scripts/test-server-auto-update.sh
run ./scripts/test-server-health-check.sh
run ./scripts/test-server-health-report.sh
run ./scripts/test-experimental-dashboard.sh

log "docker compose --env-file .env.example config"
APP_ENV_FILE=.env.example docker compose --env-file .env.example config >/dev/null

log "docker compose --env-file .env.experimental.example -f docker-compose.experimental-dashboard.yml config"
docker compose --env-file .env.experimental.example \
  -f docker-compose.experimental-dashboard.yml config >/dev/null

log "ok"
