#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DOCKER_BIN="${DOCKER_BIN:-docker}"
GIT_BIN="${GIT_BIN:-git}"
CURL_BIN="${CURL_BIN:-curl}"
PYTHON_BIN="${PYTHON_BIN:-python3}"
build_dir=""

usage() {
  cat <<'EOF'
Usage: ./scripts/dashboard-sidecar.sh <old|experimental> <command> [env-file] [source-ref]

Commands: build, start, stop, status, verify, config, logs

Defaults use the preserved October 10 source revisions. An explicit committed
source-ref selects a development build. Use the same ref for build and start.
Build never starts services; start never builds. Stop retains images and data.
EOF
}

variant="${1:-}"
command="${2:-}"
case "$variant" in
  old)
    project_name="coloradotraffictracker-old"
    service_name="old-dashboard"
    default_source="0bcedf303746ea28398143e1ba6cffe95e31563f"
    ;;
  experimental)
    project_name="coloradotraffictracker-experimental"
    service_name="experimental-dashboard"
    default_source="e47a291b64564cf4fac01a5df330ec301bfe44ba"
    ;;
  *) usage >&2; exit 2 ;;
esac
case "$command" in
  build|start|stop|status|verify|config|logs) ;;
  *) usage >&2; exit 2 ;;
esac

env_file="${3:-$ROOT_DIR/.env.$variant}"
source_ref="${4:-$default_source}"
compose_file="$ROOT_DIR/docker-compose.$variant-dashboard.yml"

revision() {
  if [[ "$source_ref" =~ ^[a-f0-9]{40}$ ]]; then
    printf '%s\n' "$source_ref"
  else
    "$GIT_BIN" -C "$ROOT_DIR" rev-parse --verify --end-of-options "$source_ref^{commit}"
  fi
}

image_name() {
  local sha
  sha="$(revision)" || return 1
  printf 'coloradotraffictracker-api-%s:%s-sidecar1\n' "$variant" "$sha"
}

compose_image() {
  local image="$1"
  shift
  OLD_DASHBOARD_IMAGE="$image" EXPERIMENT_DASHBOARD_IMAGE="$image" \
    "$DOCKER_BIN" compose --project-name "$project_name" --env-file "$env_file" \
      -f "$compose_file" "$@"
}

compose() {
  local image
  image="$(image_name)" || return 1
  compose_image "$image" "$@"
}

verify_image() {
  local expected actual
  expected="$(revision)|$variant"
  actual="$("$DOCKER_BIN" image inspect --format \
    '{{index .Config.Labels "org.opencontainers.image.revision"}}|{{index .Config.Labels "io.coloradotraffictracker.dashboard.variant"}}' \
    "$(image_name)")" || return 1
  [[ "$actual" == "$expected" ]] || {
    printf 'Sidecar image does not match the selected source and variant.\n' >&2
    return 1
  }
}

build_image() {
  local image sha
  sha="$(revision)"
  image="$(image_name)"
  if "$DOCKER_BIN" image inspect "$image" >/dev/null 2>&1; then
    verify_image
    printf 'Preserving existing sidecar image: %s\n' "$image"
    return
  fi
  build_dir="$(mktemp -d "${TMPDIR:-/tmp}/ctt-sidecar-build.XXXXXX")"
  trap 'rm -rf "$build_dir"' EXIT
  "$GIT_BIN" -C "$ROOT_DIR" archive "$sha" | tar -x -C "$build_dir"
  [[ -f "$build_dir/api-service/Dockerfile" ]] || {
    printf 'Selected source has no API Dockerfile.\n' >&2
    exit 1
  }
  if [[ "$variant" == "old" ]]; then
    "$PYTHON_BIN" "$ROOT_DIR/scripts/prepare-old-dashboard.py" "$build_dir"
  fi
  "$DOCKER_BIN" build --file "$build_dir/api-service/Dockerfile" --tag "$image" \
    --label "org.opencontainers.image.revision=$sha" \
    --label "io.coloradotraffictracker.dashboard.variant=$variant" "$build_dir"
  verify_image
  rm -rf "$build_dir"
  trap - EXIT
}

verify_upstream() {
  local published origin
  published="$(compose port "$service_name" 8080)"
  [[ "$published" =~ ^127\.0\.0\.1:[0-9]+$ ]] || {
    printf 'Sidecar must publish exactly one loopback upstream.\n' >&2
    return 1
  }
  origin="http://$published"
  "$CURL_BIN" -fsS --max-time 15 "$origin/actuator/health/readiness" >/dev/null || return 1
  "$CURL_BIN" -fsS --max-time 15 "$origin/dashboard/" >/dev/null || return 1
  "$CURL_BIN" -fsS --max-time 15 "$origin/dashboard-api/system/operational-status" >/dev/null || return 1
  printf '%s dashboard upstream verified at %s\n' "$variant" "$origin"
}

start_sidecar() {
  local previous_container previous_image=""
  verify_image
  compose config --quiet
  previous_container="$(compose ps --status running -q "$service_name")"
  if [[ -n "$previous_container" ]]; then
    previous_image="$("$DOCKER_BIN" inspect --format '{{.Config.Image}}' "$previous_container")"
  fi
  if compose up -d --no-build --wait --wait-timeout 180 "$service_name" && verify_upstream; then
    return
  fi
  if [[ -n "$previous_image" ]]; then
    printf 'Sidecar verification failed; restoring its previous image.\n' >&2
    { compose_image "$previous_image" up -d --no-build --wait --wait-timeout 180 "$service_name" && verify_upstream; } \
      || printf 'Previous sidecar image also failed readiness; inspect this sidecar before continuing.\n' >&2
  else
    printf 'Sidecar verification failed; restoring its stopped state.\n' >&2
    compose down --remove-orphans
  fi
  return 1
}

if [[ "$command" == "build" ]]; then
  build_image
  exit
fi
[[ -f "$env_file" ]] || {
  printf 'Sidecar environment file not found: %s\n' "$env_file" >&2
  exit 1
}

case "$command" in
  start) start_sidecar ;;
  stop) compose down --remove-orphans ;;
  status) compose ps ;;
  verify) verify_upstream ;;
  config) compose config --quiet ;;
  logs) compose logs -f --tail=100 "$service_name" ;;
esac
