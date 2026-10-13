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
  scripts/backups/create-database-backup.sh \
  scripts/backups/record-offsite-backup.sh \
  scripts/test-compose-health-watchdog.sh \
  scripts/test-database-backup.sh \
  scripts/test-server-auto-update.sh \
  scripts/test-server-health-check.sh \
  scripts/test-server-health-report.sh \
  scripts/dashboard-sidecar.sh \
  scripts/test-dashboard-sidecar.sh \
  scripts/test-dashboard-routing.sh \
  scripts/start-historical-replay.sh \
  scripts/test-historical-replay.sh \
  scripts/overnight-test.sh

run ./scripts/test-compose-health-watchdog.sh
run ./scripts/test-database-backup.sh
run ./scripts/test-server-auto-update.sh
run ./scripts/test-server-health-check.sh
run ./scripts/test-server-health-report.sh
run ./scripts/test-dashboard-sidecar.sh
run ./scripts/test-historical-replay.sh
run python3 -B -m unittest discover -s scripts/tests -p 'test_*.py'
run ./scripts/dashboard-sidecar.sh old config .env.old.example
run ./scripts/dashboard-sidecar.sh experimental config .env.experimental.example

log "docker compose --env-file .env.example config"
APP_ENV_FILE=.env.example docker compose --env-file .env.example config >/dev/null

log "ok"
