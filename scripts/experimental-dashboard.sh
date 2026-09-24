#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_FILE="$ROOT_DIR/docker-compose.experimental-dashboard.yml"
DOCKER_BIN="${DOCKER_BIN:-docker}"
CURL_BIN="${CURL_BIN:-curl}"
GIT_BIN="${GIT_BIN:-git}"
PROJECT_NAME="coloradotraffictracker-experimental"

usage() {
  cat <<'EOF'
Usage: ./scripts/experimental-dashboard.sh <command> [env-file]

Commands:
  start    Build the current clean revision, start it, and verify its upstream
  stop     Remove only the experimental dashboard Compose project
  status   Show the experimental dashboard container status
  verify   Check health, UI, and operational-status reads on the loopback port
  config   Validate the experimental Compose configuration without rendering secrets
  logs     Follow the experimental dashboard logs

The default env file is .env.experimental. This helper never starts or stops
the production database, ingest service, routes service, or API service.
EOF
}

command="${1:-}"
env_file="${2:-${EXPERIMENT_ENV_FILE:-$ROOT_DIR/.env.experimental}}"

require_env_file() {
  if [[ ! -f "$env_file" ]]; then
    printf 'Experimental environment file not found: %s\n' "$env_file" >&2
    printf 'Copy .env.experimental.example, populate it, and chmod 600.\n' >&2
    exit 1
  fi
}

revision() {
  "$GIT_BIN" -C "$ROOT_DIR" rev-parse --verify HEAD
}

image_name() {
  printf 'coloradotraffictracker-api-experimental:%s\n' "$(revision)"
}

compose() {
  EXPERIMENT_DASHBOARD_IMAGE="$(image_name)" \
    "$DOCKER_BIN" compose \
      --project-name "$PROJECT_NAME" \
      --env-file "$env_file" \
      -f "$COMPOSE_FILE" \
      "$@"
}

require_clean_checkout() {
  if [[ -n "$("$GIT_BIN" -C "$ROOT_DIR" status --porcelain)" ]]; then
    printf 'Refusing to build an experimental dashboard from a dirty checkout.\n' >&2
    exit 1
  fi
}

upstream_origin() {
  local published host port
  published="$(compose port experimental-dashboard 8080 | tail -n 1)"
  if [[ "$published" != *:* ]]; then
    printf 'Could not resolve the experimental dashboard loopback port.\n' >&2
    exit 1
  fi
  host="${published%:*}"
  port="${published##*:}"
  if [[ "$host" == "0.0.0.0" || "$host" == "::" ]]; then
    host="127.0.0.1"
  fi
  printf 'http://%s:%s\n' "$host" "$port"
}

verify_upstream() {
  local origin
  origin="$(upstream_origin)"
  "$CURL_BIN" -fsS "$origin/actuator/health" >/dev/null
  "$CURL_BIN" -fsS "$origin/dashboard/" >/dev/null
  "$CURL_BIN" -fsS "$origin/dashboard-api/system/operational-status" >/dev/null
  printf 'Experimental dashboard upstream verified at %s\n' "$origin"
}

case "$command" in
  start)
    require_env_file
    require_clean_checkout
    compose config --quiet
    compose up -d --build --wait --wait-timeout 180
    verify_upstream
    printf 'Public route after Caddy setup: /dashboard-experimental/\n'
    ;;
  stop)
    require_env_file
    compose down --remove-orphans
    ;;
  status)
    require_env_file
    compose ps
    ;;
  verify)
    require_env_file
    verify_upstream
    ;;
  config)
    require_env_file
    compose config --quiet
    printf 'Experimental dashboard Compose configuration is valid.\n'
    ;;
  logs)
    require_env_file
    compose logs -f --tail=200 experimental-dashboard
    ;;
  -h|--help|help)
    usage
    ;;
  *)
    usage >&2
    exit 2
    ;;
esac
