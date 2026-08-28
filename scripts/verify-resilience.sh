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
  scripts/test-compose-health-watchdog.sh \
  scripts/test-server-health-check.sh \
  scripts/overnight-test.sh

run ./scripts/test-compose-health-watchdog.sh
run ./scripts/test-server-health-check.sh

log "docker compose --env-file .env.example config"
APP_ENV_FILE=.env.example docker compose --env-file .env.example config >/dev/null

log "ok"
