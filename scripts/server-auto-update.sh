#!/usr/bin/env bash
set -Eeuo pipefail

APP_DIR="${APP_DIR:-/opt/colorado-traffic-tracker}"
ENV_FILE="${ENV_FILE:-.env.cloud}"
HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:8080/actuator/health/readiness}"
HEALTH_TIMEOUT_SECONDS="${HEALTH_TIMEOUT_SECONDS:-180}"
LOG_TAG="ctt-auto-update"

compose() {
  APP_ENV_FILE="$ENV_FILE" docker compose --env-file "$ENV_FILE" "$@"
}

wait_for_readiness() {
  local deadline=$((SECONDS + HEALTH_TIMEOUT_SECONDS))
  while ((SECONDS < deadline)); do
    if curl -fsS "$HEALTH_URL" >/dev/null; then
      return 0
    fi
    sleep 5
  done
  return 1
}

cd "$APP_DIR"

exec 9>/var/lock/colorado-traffic-tracker-auto-update.lock
flock -n 9 || exit 0

logger -t "$LOG_TAG" "checking origin/main"

if ! git diff --quiet || ! git diff --cached --quiet; then
  logger -t "$LOG_TAG" "tracked local changes detected; aborting auto-update"
  exit 1
fi

previous_sha="$(git rev-parse HEAD)"
git fetch origin main
remote_sha="$(git rev-parse origin/main)"

if [[ "$previous_sha" == "$remote_sha" ]]; then
  logger -t "$LOG_TAG" "already up to date at $previous_sha"
  exit 0
fi

logger -t "$LOG_TAG" "updating from $previous_sha to $remote_sha"
git checkout main
git merge --ff-only origin/main
compose up -d --build --remove-orphans

if ! wait_for_readiness; then
  logger -t "$LOG_TAG" "readiness check failed; rolling back to $previous_sha"
  git reset --hard "$previous_sha"
  compose up -d --build --remove-orphans
  wait_for_readiness || logger -t "$LOG_TAG" "rollback completed but API readiness is still failing"
  exit 1
fi

docker image prune -f --filter "until=168h" >/dev/null || true
docker builder prune -f --filter "until=168h" >/dev/null || true
logger -t "$LOG_TAG" "updated successfully to $remote_sha"
