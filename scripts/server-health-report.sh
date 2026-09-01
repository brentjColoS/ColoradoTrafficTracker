#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HEALTH_CHECK_SCRIPT="${HEALTH_CHECK_SCRIPT:-$ROOT_DIR/scripts/server-health-check.sh}"
HEALTHCHECKS_PING_URL="${HEALTHCHECKS_PING_URL:-}"
HEALTHCHECKS_TIMEOUT_SECONDS="${HEALTHCHECKS_TIMEOUT_SECONDS:-15}"
CURL_BIN="${CURL_BIN:-curl}"

log() {
  printf '[server-health-report] %s\n' "$*"
}

set +e
check_output="$("$HEALTH_CHECK_SCRIPT" 2>&1)"
check_status=$?
set -e

printf '%s\n' "$check_output"

if [[ -z "$HEALTHCHECKS_PING_URL" ]]; then
  log "heartbeat disabled: HEALTHCHECKS_PING_URL is not configured"
  exit "$check_status"
fi

ping_url="${HEALTHCHECKS_PING_URL%/}"
if (( check_status != 0 )); then
  ping_url="$ping_url/fail"
fi

payload="$(
  printf 'checked_at=%s\nexit_status=%s\n%s\n' \
    "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    "$check_status" \
    "$check_output"
)"

if ! "$CURL_BIN" \
  -fsS \
  --max-time "$HEALTHCHECKS_TIMEOUT_SECONDS" \
  --retry 2 \
  --data-binary "$payload" \
  "$ping_url" >/dev/null; then
  log "failed: Healthchecks.io did not accept the heartbeat"
  exit 1
fi

log "heartbeat delivered"
exit "$check_status"
