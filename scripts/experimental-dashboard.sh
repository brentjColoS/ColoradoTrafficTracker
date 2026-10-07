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
       ./scripts/experimental-dashboard.sh rollback <full-commit-sha> [env-file]

Commands:
  start    Build the current clean revision, start it, and verify its upstream
  build    Build the clean current revision without replacing any container
  deploy   Start the already-built current revision and verify its upstream
  rollback Restore an existing commit-tagged experimental image without rebuilding
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
selected_revision=""
if [[ "$command" == "rollback" ]]; then
  selected_revision="${2:-}"
  if [[ ! "$selected_revision" =~ ^[0-9a-f]{40}$ ]]; then
    printf 'Rollback requires a full lowercase commit SHA.\n' >&2
    exit 2
  fi
  env_file="${3:-${EXPERIMENT_ENV_FILE:-$ROOT_DIR/.env.experimental}}"
fi

require_env_file() {
  if [[ ! -f "$env_file" ]]; then
    printf 'Experimental environment file not found: %s\n' "$env_file" >&2
    printf 'Copy .env.experimental.example, populate it, and chmod 600.\n' >&2
    exit 1
  fi
}

revision() {
  local value
  value="${selected_revision:-$("$GIT_BIN" -C "$ROOT_DIR" rev-parse --verify HEAD)}"
  if [[ ! "$value" =~ ^[0-9a-f]{40}$ ]]; then
    printf 'Experimental image revision must be a full lowercase commit SHA.\n' >&2
    return 1
  fi
  printf '%s\n' "$value"
}

image_name() {
  local value
  value="$(revision)" || return 1
  printf 'coloradotraffictracker-api-experimental:%s\n' "$value"
}

compose() {
  local image
  image="$(image_name)" || return 1
  EXPERIMENT_DASHBOARD_IMAGE="$image" \
    "$DOCKER_BIN" compose \
      --project-name "$PROJECT_NAME" \
      --env-file "$env_file" \
      -f "$COMPOSE_FILE" \
      "$@"
}

require_clean_checkout() {
  local changes
  if ! changes="$("$GIT_BIN" -C "$ROOT_DIR" status --porcelain)"; then
    printf 'Could not verify the experimental checkout state.\n' >&2
    return 1
  fi
  if [[ -n "$changes" ]]; then
    printf 'Refusing an experimental release from a dirty checkout.\n' >&2
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
  "$CURL_BIN" -fsS --max-time 10 "$origin/actuator/health" >/dev/null
  "$CURL_BIN" -fsS --max-time 10 "$origin/actuator/health/readiness" >/dev/null
  "$CURL_BIN" -fsS --max-time 10 "$origin/dashboard/" >/dev/null
  "$CURL_BIN" -fsS --max-time 10 "$origin/dashboard-api/system/operational-status" >/dev/null
  printf 'Experimental dashboard upstream verified at %s\n' "$origin"
}

build_image() {
  compose build experimental-dashboard
}

deploy_image() {
  local image
  image="$(image_name)"
  if ! "$DOCKER_BIN" image inspect "$image" >/dev/null 2>&1; then
    printf 'Experimental image is not available locally: %s\n' "$image" >&2
    return 1
  fi
  compose up -d --no-build --wait --wait-timeout 180 experimental-dashboard
  verify_upstream
}

case "$command" in
  start)
    require_env_file
    require_clean_checkout
    compose config --quiet
    build_image
    deploy_image
    printf 'Public route after Caddy setup: /dashboard-experimental/\n'
    ;;
  build)
    require_env_file
    require_clean_checkout
    compose config --quiet
    build_image
    ;;
  deploy|rollback)
    require_env_file
    require_clean_checkout
    compose config --quiet
    deploy_image
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
