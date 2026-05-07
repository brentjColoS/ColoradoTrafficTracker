#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCRIPT="$ROOT_DIR/scripts/compose-health-watchdog.sh"

fail() {
  printf '[test-compose-health-watchdog] %s\n' "$*" >&2
  exit 1
}

assert_file_contains() {
  local file="$1"
  local expected="$2"
  if ! grep -Fq "$expected" "$file"; then
    printf 'Expected %s to contain: %s\n' "$file" "$expected" >&2
    printf 'Actual contents:\n' >&2
    cat "$file" >&2 || true
    exit 1
  fi
}

assert_file_not_contains() {
  local file="$1"
  local unexpected="$2"
  if grep -Fq "$unexpected" "$file"; then
    printf 'Expected %s not to contain: %s\n' "$file" "$unexpected" >&2
    printf 'Actual contents:\n' >&2
    cat "$file" >&2 || true
    exit 1
  fi
}

write_fake_docker() {
  local fake_bin="$1"
  cat > "$fake_bin" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

state_dir="${FAKE_DOCKER_STATE_DIR:?}"

if [[ "${1:-}" == "compose" ]]; then
  shift
  if [[ "${1:-}" == "--env-file" ]]; then
    shift 2
  fi
  case "${1:-}" in
    ps)
      [[ "${2:-}" == "-q" ]] || exit 2
      printf 'container-%s\n' "${3:-}"
      ;;
    restart)
      printf '%s\n' "${2:-}" >> "$state_dir/restarts.log"
      printf 'healthy\n' > "$state_dir/health-${2:-}"
      ;;
    *)
      exit 2
      ;;
  esac
  exit 0
fi

if [[ "${1:-}" == "inspect" ]]; then
  container_id="${4:-}"
  service="${container_id#container-}"
  cat "$state_dir/health-$service"
  exit 0
fi

exit 2
EOF
  chmod +x "$fake_bin"
}

run_case() {
  local name="$1"
  local initial_health="$2"
  local expected_restart="$3"
  local temp_dir
  temp_dir="$(mktemp -d)"
  trap 'rm -rf "$temp_dir"' RETURN

  write_fake_docker "$temp_dir/docker"
  printf '%s\n' "$initial_health" > "$temp_dir/health-api-service"
  : > "$temp_dir/restarts.log"
  cat > "$temp_dir/watchdog.env" <<'EOF'
COMPOSE_HEALTH_WATCHDOG_SERVICES=api-service
COMPOSE_HEALTH_WATCHDOG_INTERVAL_SECONDS=1
COMPOSE_HEALTH_WATCHDOG_FAILURES=2
COMPOSE_HEALTH_WATCHDOG_COOLDOWN_SECONDS=0
COMPOSE_HEALTH_WATCHDOG_MAX_CHECKS=2
EOF

  FAKE_DOCKER_STATE_DIR="$temp_dir" \
    DOCKER_BIN="$temp_dir/docker" \
    "$SCRIPT" run "$temp_dir/watchdog.env" > "$temp_dir/output.log"

  assert_file_contains "$temp_dir/output.log" "completed 2 watchdog checks"
  if [[ "$expected_restart" == "yes" ]]; then
    assert_file_contains "$temp_dir/restarts.log" "api-service"
  else
    assert_file_not_contains "$temp_dir/restarts.log" "api-service"
  fi

  printf '[test-compose-health-watchdog] ok - %s\n' "$name"
}

[[ -x "$SCRIPT" ]] || fail "Watchdog script is not executable: $SCRIPT"
bash -n "$SCRIPT"

run_case "restarts repeatedly unhealthy service" "unhealthy" "yes"
run_case "does not restart healthy service" "healthy" "no"
