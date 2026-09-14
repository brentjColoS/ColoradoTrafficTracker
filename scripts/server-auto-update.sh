#!/usr/bin/env bash
set -Eeuo pipefail

APP_DIR="${APP_DIR:-/opt/colorado-traffic-tracker}"
ENV_FILE="${ENV_FILE:-.env.cloud}"
HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:8080/actuator/health/readiness}"
LATEST_TRAFFIC_URL="${LATEST_TRAFFIC_URL:-http://127.0.0.1:8080/dashboard-api/traffic/latest}"
OPERATIONAL_STATUS_URL="${OPERATIONAL_STATUS_URL:-http://127.0.0.1:8080/dashboard-api/system/operational-status}"
HEALTH_TIMEOUT_SECONDS="${HEALTH_TIMEOUT_SECONDS:-180}"
INGEST_PROGRESS_TIMEOUT_SECONDS="${INGEST_PROGRESS_TIMEOUT_SECONDS:-360}"
POLL_INTERVAL_SECONDS="${POLL_INTERVAL_SECONDS:-5}"
LOCK_FILE="${LOCK_FILE:-/var/lock/colorado-traffic-tracker-auto-update.lock}"
CURL_BIN="${CURL_BIN:-curl}"
DOCKER_BIN="${DOCKER_BIN:-docker}"
FLOCK_BIN="${FLOCK_BIN:-flock}"
GIT_BIN="${GIT_BIN:-git}"
LOGGER_BIN="${LOGGER_BIN:-logger}"
SLEEP_BIN="${SLEEP_BIN:-sleep}"
LOG_TAG="ctt-auto-update"

log() {
  "$LOGGER_BIN" -t "$LOG_TAG" "$*"
}

compose() {
  APP_ENV_FILE="$ENV_FILE" "$DOCKER_BIN" compose --env-file "$ENV_FILE" "$@"
}

latest_sample_id() {
  local corridor="$1"
  local response

  response="$("$CURL_BIN" -fsS "${LATEST_TRAFFIC_URL}?corridor=${corridor}&preferUsable=true")" || return 1
  if [[ "$response" =~ \"id\":([0-9]+) ]]; then
    printf '%s\n' "${BASH_REMATCH[1]}"
    return 0
  fi
  return 1
}

operational_status() {
  local response

  response="$("$CURL_BIN" -fsS "$OPERATIONAL_STATUS_URL")" || return 1
  if [[ "$response" =~ ^\{\"status\":\"([^\"]+)\" ]]; then
    printf '%s\n' "${BASH_REMATCH[1]}"
    return 0
  fi
  return 1
}

wait_for_readiness() {
  local deadline=$((SECONDS + HEALTH_TIMEOUT_SECONDS))
  while ((SECONDS < deadline)); do
    if "$CURL_BIN" -fsS "$HEALTH_URL" >/dev/null; then
      return 0
    fi
    "$SLEEP_BIN" "$POLL_INTERVAL_SECONDS"
  done
  return 1
}

wait_for_live_ingest() {
  local i25_baseline="$1"
  local i70_baseline="$2"
  local deadline=$((SECONDS + INGEST_PROGRESS_TIMEOUT_SECONDS))
  local i25_current=""
  local i70_current=""
  local status="UNAVAILABLE"

  while ((SECONDS < deadline)); do
    i25_current="$(latest_sample_id I25 || true)"
    i70_current="$(latest_sample_id I70 || true)"
    status="$(operational_status || true)"

    if [[ -n "$i25_current" && "$i25_current" != "$i25_baseline" \
      && -n "$i70_current" && "$i70_current" != "$i70_baseline" \
      && "$status" == "HEALTHY" ]]; then
      return 0
    fi
    "$SLEEP_BIN" "$POLL_INTERVAL_SECONDS"
  done

  log "live ingest verification timed out: I25 ${i25_baseline}->${i25_current:-unavailable}, I70 ${i70_baseline}->${i70_current:-unavailable}, operational status ${status:-unavailable}"
  return 1
}

rollback() {
  local previous_sha="$1"

  log "deployment verification failed; rolling back to $previous_sha"
  "$GIT_BIN" reset --hard "$previous_sha"
  compose up -d --build --remove-orphans
  wait_for_readiness || log "rollback completed but API readiness is still failing"
}

cd "$APP_DIR"

exec 9>"$LOCK_FILE"
"$FLOCK_BIN" -n 9 || exit 0

log "checking origin/main"

if ! "$GIT_BIN" diff --quiet || ! "$GIT_BIN" diff --cached --quiet; then
  log "tracked local changes detected; aborting auto-update"
  exit 1
fi

previous_sha="$("$GIT_BIN" rev-parse HEAD)"
"$GIT_BIN" fetch origin main
remote_sha="$("$GIT_BIN" rev-parse origin/main)"

if [[ "$previous_sha" == "$remote_sha" ]]; then
  log "already up to date at $previous_sha"
  exit 0
fi

if ! latest_sample_id I25 >/dev/null || ! latest_sample_id I70 >/dev/null; then
  log "current corridor data is unavailable; aborting auto-update before changing the checkout"
  exit 1
fi

log "updating from $previous_sha to $remote_sha"
"$GIT_BIN" checkout main
"$GIT_BIN" merge --ff-only origin/main
compose up -d --build --remove-orphans

if ! wait_for_readiness; then
  log "API readiness check timed out"
  rollback "$previous_sha"
  exit 1
fi

i25_baseline="$(latest_sample_id I25 || true)"
i70_baseline="$(latest_sample_id I70 || true)"
if [[ -z "$i25_baseline" || -z "$i70_baseline" ]] \
  || ! wait_for_live_ingest "$i25_baseline" "$i70_baseline"; then
  rollback "$previous_sha"
  exit 1
fi

"$DOCKER_BIN" image prune -f --filter "until=168h" >/dev/null || true
"$DOCKER_BIN" builder prune -f --filter "until=168h" >/dev/null || true
log "updated successfully to $remote_sha after both corridors produced new samples"
