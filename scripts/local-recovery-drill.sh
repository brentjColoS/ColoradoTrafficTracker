#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STATE_ROOT="$ROOT_DIR/.local/recovery-drills"

usage() {
  cat <<'EOF'
Usage:
  ./scripts/local-recovery-drill.sh status [env-file]
  ./scripts/local-recovery-drill.sh repair [env-file]
  ./scripts/local-recovery-drill.sh snapshot [env-file] [output-dir]

Behavior:
  - status: show Compose service state and key local health endpoint HTTP codes.
  - repair: run `docker compose up -d`, then perform one bounded watchdog pass
    that restarts unhealthy app containers immediately.
  - snapshot: capture Compose status, health endpoint payloads, provider status,
    and recent service logs under .local/recovery-drills/<timestamp>/.
EOF
}

log() {
  printf '[local-recovery-drill] %s\n' "$*"
}

fail() {
  log "$*" >&2
  exit 1
}

resolve_path() {
  local path="$1"
  if [[ "$path" = /* ]]; then
    printf '%s\n' "$path"
  else
    printf '%s\n' "$ROOT_DIR/$path"
  fi
}

resolve_env_file() {
  local requested="${1:-}"
  if [[ -n "$requested" ]]; then
    resolve_path "$requested"
    return
  fi
  if [[ -n "${APP_ENV_FILE:-}" ]]; then
    resolve_path "${APP_ENV_FILE}"
    return
  fi
  if [[ -f "$ROOT_DIR/.env" ]]; then
    printf '%s\n' "$ROOT_DIR/.env"
    return
  fi
  printf '%s\n' "$ROOT_DIR/.env.example"
}

compose() {
  APP_ENV_FILE="$ENV_FILE" docker compose --env-file "$ENV_FILE" "$@"
}

capture_endpoint() {
  local url="$1"
  local output_file="$2"
  local stderr_file="${output_file}.stderr"
  local http_code

  http_code="$(curl -sS -L -o "$output_file" -w '%{http_code}' "$url" 2>"$stderr_file" || true)"
  if [[ ! -s "$stderr_file" ]]; then
    rm -f "$stderr_file"
  fi

  printf '%s\n' "$http_code"
}

print_endpoint_code() {
  local label="$1"
  local url="$2"
  local code
  code="$(curl -sS -o /dev/null -w '%{http_code}' "$url" || true)"
  printf '%-28s %s %s\n' "$label" "$code" "$url"
}

run_status() {
  log "Compose services"
  compose ps
  printf '\n'
  log "Local endpoints"
  print_endpoint_code "api actuator health" "http://localhost:8080/actuator/health"
  print_endpoint_code "api traffic health" "http://localhost:8080/api/traffic/health"
  print_endpoint_code "routes corridors" "http://localhost:8081/routes/corridors"
  print_endpoint_code "ingest actuator health" "http://localhost:8082/actuator/health"
  print_endpoint_code "provider status" "http://localhost:8080/dashboard-api/system/provider-status"
}

run_repair() {
  log "Ensuring Compose stack is started"
  compose up -d

  log "Restarting unhealthy app containers after one failed watchdog check"
  COMPOSE_HEALTH_WATCHDOG_SERVICES="${COMPOSE_HEALTH_WATCHDOG_SERVICES:-api-service ingest-service routes-service}" \
  COMPOSE_HEALTH_WATCHDOG_FAILURES=1 \
  COMPOSE_HEALTH_WATCHDOG_MAX_CHECKS=1 \
  COMPOSE_HEALTH_WATCHDOG_COOLDOWN_SECONDS=0 \
    "$ROOT_DIR/scripts/compose-health-watchdog.sh" run "$ENV_FILE"

  printf '\n'
  run_status
}

run_snapshot() {
  local requested_output="${1:-}"
  local output_dir
  if [[ -n "$requested_output" ]]; then
    output_dir="$(resolve_path "$requested_output")"
  else
    output_dir="$STATE_ROOT/$(date -u +%Y%m%dT%H%M%SZ)"
  fi
  mkdir -p "$output_dir"

  log "Capturing recovery snapshot in $output_dir"
  compose ps > "$output_dir/compose-ps.txt" 2>&1 || true
  compose logs --tail=300 > "$output_dir/compose-logs-tail.txt" 2>&1 || true

  {
    printf 'captured_at\tlabel\thttp_code\turl\n'
    local code
    code="$(capture_endpoint "http://localhost:8080/actuator/health" "$output_dir/api-actuator-health.json")"
    printf '%s\tapi_actuator_health\t%s\thttp://localhost:8080/actuator/health\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$code"
    code="$(capture_endpoint "http://localhost:8080/api/traffic/health" "$output_dir/api-traffic-health.txt")"
    printf '%s\tapi_traffic_health\t%s\thttp://localhost:8080/api/traffic/health\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$code"
    code="$(capture_endpoint "http://localhost:8081/routes/corridors" "$output_dir/routes-corridors.json")"
    printf '%s\troutes_corridors\t%s\thttp://localhost:8081/routes/corridors\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$code"
    code="$(capture_endpoint "http://localhost:8082/actuator/health" "$output_dir/ingest-actuator-health.json")"
    printf '%s\tingest_actuator_health\t%s\thttp://localhost:8082/actuator/health\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$code"
    code="$(capture_endpoint "http://localhost:8080/dashboard-api/system/provider-status" "$output_dir/provider-status.json")"
    printf '%s\tprovider_status\t%s\thttp://localhost:8080/dashboard-api/system/provider-status\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$code"
  } > "$output_dir/endpoints.tsv"

  log "Snapshot complete: $output_dir"
}

main() {
  local command="${1:-}"
  shift || true

  case "$command" in
    status|repair|snapshot)
      ENV_FILE="$(resolve_env_file "${1:-}")"
      [[ -f "$ENV_FILE" ]] || fail "Env file not found: $ENV_FILE"
      if [[ "$command" == "snapshot" ]]; then
        shift || true
      fi
      ;;
  esac

  case "$command" in
    status)
      run_status
      ;;
    repair)
      run_repair
      ;;
    snapshot)
      run_snapshot "${1:-}"
      ;;
    -h|--help|help|"")
      usage
      ;;
    *)
      usage >&2
      exit 1
      ;;
  esac
}

main "$@"
