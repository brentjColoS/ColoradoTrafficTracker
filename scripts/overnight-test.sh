#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STATE_ROOT="$ROOT_DIR/.local/overnight-tests"
CURRENT_RUN_FILE="$STATE_ROOT/current-run.env"

usage() {
  cat <<'EOF'
Usage:
  ./scripts/overnight-test.sh start [env-file]
  ./scripts/overnight-test.sh status
  ./scripts/overnight-test.sh stop [--down]
  ./scripts/overnight-test.sh report [run-dir]

Behavior:
  - `start` boots Docker Compose in detached mode, tails compose logs, and
    captures periodic health/data snapshots under .local/overnight-tests/.
  - `status` shows the active run, if one is being monitored.
  - `stop` stops the background log/snapshot workers. Add --down to also stop
    the compose stack.
  - `report` prints a compact summary for the active run or a specific run dir.
EOF
}

log() {
  printf '[overnight-test] %s\n' "$*"
}

fail() {
  printf '[overnight-test] %s\n' "$*" >&2
  exit 1
}

ensure_state_root() {
  mkdir -p "$STATE_ROOT"
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
  if [[ -f "$ROOT_DIR/overnight-test.env" ]]; then
    printf '%s\n' "$ROOT_DIR/overnight-test.env"
    return
  fi
  printf '%s\n' "$ROOT_DIR/.env"
}

load_env_file() {
  local env_file="$1"
  [[ -f "$env_file" ]] || fail "Env file not found: $env_file"
  set -a
  # shellcheck disable=SC1090
  source "$env_file"
  set +a
}

compose() {
  APP_ENV_FILE="$ENV_FILE" docker compose --env-file "$ENV_FILE" "$@"
}

pid_alive() {
  local pid="${1:-}"
  [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null
}

write_state() {
  ensure_state_root
  {
    printf 'RUN_DIR=%q\n' "$RUN_DIR"
    printf 'ENV_FILE=%q\n' "$ENV_FILE"
    printf 'CORRIDOR=%q\n' "$CORRIDOR"
    printf 'MONITOR_SECONDS=%q\n' "$MONITOR_SECONDS"
    printf 'STARTUP_TIMEOUT_SECONDS=%q\n' "$STARTUP_TIMEOUT_SECONDS"
    printf 'STARTED_AT=%q\n' "$STARTED_AT"
    printf 'LOGS_PID=%q\n' "$LOGS_PID"
    printf 'MONITOR_PID=%q\n' "$MONITOR_PID"
  } > "$CURRENT_RUN_FILE"
}

load_state() {
  [[ -f "$CURRENT_RUN_FILE" ]] || fail "No active overnight run state found."
  # shellcheck disable=SC1090
  source "$CURRENT_RUN_FILE"
}

clear_state_if_stale() {
  if [[ -f "$CURRENT_RUN_FILE" ]]; then
    # shellcheck disable=SC1090
    source "$CURRENT_RUN_FILE"
    if ! pid_alive "${LOGS_PID:-}" && ! pid_alive "${MONITOR_PID:-}"; then
      rm -f "$CURRENT_RUN_FILE"
    fi
  fi
}

require_ready_config() {
  local monitor_seconds="${OVERNIGHT_MONITOR_SECONDS:-300}"
  local poll_seconds="${TRAFFIC_POLL_SECONDS:-60}"
  local startup_timeout_seconds="${OVERNIGHT_STARTUP_TIMEOUT_SECONDS:-300}"

  [[ -n "${TOMTOM_API_KEY:-}" ]] || fail "TOMTOM_API_KEY is missing from $ENV_FILE"
  [[ "${TOMTOM_API_KEY}" != "replace-with-your-tomtom-key" ]] || fail "Replace TOMTOM_API_KEY in $ENV_FILE before starting the run"
  [[ "$monitor_seconds" =~ ^[0-9]+$ ]] || fail "OVERNIGHT_MONITOR_SECONDS must be a whole number"
  [[ "$poll_seconds" =~ ^[0-9]+$ ]] || fail "TRAFFIC_POLL_SECONDS must be a whole number"
  [[ "$startup_timeout_seconds" =~ ^[0-9]+$ ]] || fail "OVERNIGHT_STARTUP_TIMEOUT_SECONDS must be a whole number"
  (( monitor_seconds > 0 )) || fail "OVERNIGHT_MONITOR_SECONDS must be greater than zero"
  (( poll_seconds > 0 )) || fail "TRAFFIC_POLL_SECONDS must be greater than zero"
  (( startup_timeout_seconds > 0 )) || fail "OVERNIGHT_STARTUP_TIMEOUT_SECONDS must be greater than zero"
}

create_run_dir() {
  local run_id
  run_id="$(date -u +%Y%m%dT%H%M%SZ)"
  RUN_DIR="$STATE_ROOT/$run_id"
  mkdir -p "$RUN_DIR/snapshots"
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

json_string() {
  local file="$1"
  local field="$2"
  [[ -s "$file" ]] || {
    printf 'n/a\n'
    return
  }
  local value
  value="$(sed -n "s/.*\"$field\":\"\\([^\"]*\\)\".*/\\1/p" "$file" | head -n 1)"
  printf '%s\n' "${value:-n/a}"
}

json_bool() {
  local file="$1"
  local field="$2"
  [[ -s "$file" ]] || {
    printf 'n/a\n'
    return
  }
  local value
  value="$(sed -n "s/.*\"$field\":\\(true\\|false\\).*/\\1/p" "$file" | head -n 1)"
  printf '%s\n' "${value:-n/a}"
}

wait_for_http() {
  local url="$1"
  local expected="$2"
  local timeout_seconds="$3"
  local started_at
  started_at="$(date +%s)"

  while true; do
    local code
    code="$(curl -sS -o /dev/null -w '%{http_code}' "$url" || true)"
    if [[ "$code" == "$expected" ]]; then
      return 0
    fi
    if (( "$(date +%s)" - started_at >= timeout_seconds )); then
      return 1
    fi
    sleep 5
  done
}

wait_for_stack_readiness() {
  local timeout_seconds="$1"

  wait_for_http "http://localhost:8080/actuator/health" "200" "$timeout_seconds" && \
    wait_for_http "http://localhost:8082/actuator/health" "200" "$timeout_seconds"
}

run_monitor_loop() {
  local run_dir="$1"
  local corridor="$2"
  local interval_seconds="$3"
  local startup_timeout_seconds="$4"
  local summary_file="$run_dir/summary.tsv"

  trap 'exit 0' INT TERM

  if [[ ! -f "$summary_file" ]]; then
    printf 'captured_at\tapi_health_http\tingest_health_http\tprovider_status_http\tprovider_state\tprovider_halted\tlatest_http\tlatest_polled_at\n' > "$summary_file"
  fi

  if wait_for_stack_readiness "$startup_timeout_seconds"; then
    printf 'Stack readiness reached before monitoring began (%s)\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$run_dir/monitor-readiness.txt"
  else
    printf 'Stack did not become ready within %s seconds; monitoring began anyway at %s\n' \
      "$startup_timeout_seconds" \
      "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$run_dir/monitor-readiness.txt"
  fi

  while true; do
    local capture_id
    local captured_at
    local sample_dir
    local api_health_http
    local ingest_health_http
    local provider_http
    local latest_http
    local provider_state
    local provider_halted
    local latest_polled_at

    capture_id="$(date -u +%Y%m%dT%H%M%SZ)"
    captured_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    sample_dir="$run_dir/snapshots/$capture_id"
    mkdir -p "$sample_dir"

    api_health_http="$(capture_endpoint "http://localhost:8080/api/traffic/health" "$sample_dir/api-traffic-health.txt")"
    ingest_health_http="$(capture_endpoint "http://localhost:8082/actuator/health" "$sample_dir/ingest-health.json")"
    provider_http="$(capture_endpoint "http://localhost:8080/dashboard-api/system/provider-status" "$sample_dir/provider-status.json")"
    latest_http="$(capture_endpoint "http://localhost:8080/dashboard-api/traffic/latest?corridor=${corridor}&preferUsable=true" "$sample_dir/latest.json")"

    provider_state="$(json_string "$sample_dir/provider-status.json" "state")"
    provider_halted="$(json_bool "$sample_dir/provider-status.json" "halted")"
    latest_polled_at="$(json_string "$sample_dir/latest.json" "polledAt")"

    printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' \
      "$captured_at" \
      "$api_health_http" \
      "$ingest_health_http" \
      "$provider_http" \
      "$provider_state" \
      "$provider_halted" \
      "$latest_http" \
      "$latest_polled_at" >> "$summary_file"

    sleep "$interval_seconds"
  done
}

tail_compose_logs() {
  local run_dir="$1"
  compose logs -f --no-color > "$run_dir/compose.log" 2>&1
}

start_run() {
  clear_state_if_stale
  [[ ! -f "$CURRENT_RUN_FILE" ]] || fail "An overnight run is already active. Use status or stop first."

  ENV_FILE="$(resolve_env_file "${1:-}")"
  load_env_file "$ENV_FILE"
  require_ready_config

  CORRIDOR="${OVERNIGHT_CORRIDOR:-I25}"
  MONITOR_SECONDS="${OVERNIGHT_MONITOR_SECONDS:-300}"
  STARTUP_TIMEOUT_SECONDS="${OVERNIGHT_STARTUP_TIMEOUT_SECONDS:-300}"
  STARTED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

  create_run_dir

  log "Starting Docker Compose with env file $ENV_FILE"
  compose up --build -d

  nohup "$0" _logs "$RUN_DIR" "$ENV_FILE" > "$RUN_DIR/log-capture.out" 2>&1 &
  LOGS_PID="$!"

  if wait_for_stack_readiness "$STARTUP_TIMEOUT_SECONDS"; then
    log "Stack is responding on actuator health endpoints. Starting monitoring in $RUN_DIR"
  else
    log "Stack did not become ready within ${STARTUP_TIMEOUT_SECONDS}s. Monitoring will still start so the run captures late recovery."
  fi

  nohup "$0" _monitor "$RUN_DIR" "$ENV_FILE" "$CORRIDOR" "$MONITOR_SECONDS" "$STARTUP_TIMEOUT_SECONDS" > "$RUN_DIR/monitor.out" 2>&1 &
  MONITOR_PID="$!"

  write_state

  report_run "$RUN_DIR"
}

stop_run() {
  local bring_down="${1:-false}"

  clear_state_if_stale
  load_state

  if pid_alive "${MONITOR_PID:-}"; then
    kill "$MONITOR_PID"
  fi
  if pid_alive "${LOGS_PID:-}"; then
    kill "$LOGS_PID"
  fi

  wait "${MONITOR_PID:-}" 2>/dev/null || true
  wait "${LOGS_PID:-}" 2>/dev/null || true

  if [[ "$bring_down" == "true" ]]; then
    log "Stopping Docker Compose services"
    compose down
  fi

  rm -f "$CURRENT_RUN_FILE"
  report_run "$RUN_DIR"
}

report_run() {
  local run_dir="${1:-}"
  local summary_file
  local snapshot_count
  local captured_at="n/a"
  local api_http="n/a"
  local ingest_http="n/a"
  local provider_http="n/a"
  local provider_state="n/a"
  local provider_halted="n/a"
  local latest_http="n/a"
  local latest_polled_at="n/a"

  [[ -n "$run_dir" ]] || fail "Run directory is required for report output"
  summary_file="$run_dir/summary.tsv"
  snapshot_count="$(find "$run_dir/snapshots" -mindepth 1 -maxdepth 1 -type d 2>/dev/null | wc -l | tr -d ' ')"

  if [[ -f "$summary_file" ]] && [[ "$(wc -l < "$summary_file")" -gt 1 ]]; then
    IFS=$'\t' read -r captured_at api_http ingest_http provider_http provider_state provider_halted latest_http latest_polled_at < <(tail -n 1 "$summary_file")
  fi

  printf 'Run directory: %s\n' "$run_dir"
  printf 'Snapshots captured: %s\n' "${snapshot_count:-0}"
  printf 'Latest capture: %s\n' "$captured_at"
  printf 'API health HTTP: %s\n' "$api_http"
  printf 'Ingest health HTTP: %s\n' "$ingest_http"
  printf 'Provider status HTTP: %s\n' "$provider_http"
  printf 'Provider state: %s\n' "$provider_state"
  printf 'Provider halted: %s\n' "$provider_halted"
  printf 'Latest sample HTTP: %s\n' "$latest_http"
  printf 'Latest sample polledAt: %s\n' "$latest_polled_at"
  printf 'Compose log: %s\n' "$run_dir/compose.log"
  printf 'Summary file: %s\n' "$summary_file"
}

status_run() {
  clear_state_if_stale
  load_state

  printf 'Started at: %s\n' "${STARTED_AT:-unknown}"
  printf 'Env file: %s\n' "${ENV_FILE:-unknown}"
  printf 'Corridor probe: %s\n' "${CORRIDOR:-unknown}"
  printf 'Monitor interval: %s seconds\n' "${MONITOR_SECONDS:-unknown}"
  printf 'Startup timeout: %s seconds\n' "${STARTUP_TIMEOUT_SECONDS:-unknown}"
  printf 'Monitor PID: %s (%s)\n' "${MONITOR_PID:-n/a}" "$(pid_alive "${MONITOR_PID:-}" && printf 'running' || printf 'stopped')"
  printf 'Log PID: %s (%s)\n' "${LOGS_PID:-n/a}" "$(pid_alive "${LOGS_PID:-}" && printf 'running' || printf 'stopped')"
  report_run "$RUN_DIR"
}

main() {
  local command="${1:-}"
  ensure_state_root

  case "$command" in
    start)
      start_run "${2:-}"
      ;;
    status)
      status_run
      ;;
    stop)
      if [[ "${2:-}" == "--down" ]]; then
        stop_run true
      else
        stop_run false
      fi
      ;;
    report)
      if [[ -n "${2:-}" ]]; then
        report_run "$(resolve_path "$2")"
      else
        clear_state_if_stale
        if [[ -f "$CURRENT_RUN_FILE" ]]; then
          load_state
          report_run "$RUN_DIR"
        else
          local latest_dir
          latest_dir="$(find "$STATE_ROOT" -mindepth 1 -maxdepth 1 -type d | sort | tail -n 1)"
          [[ -n "$latest_dir" ]] || fail "No overnight run artifacts found in $STATE_ROOT"
          report_run "$latest_dir"
        fi
      fi
      ;;
    _monitor)
      RUN_DIR="$2"
      ENV_FILE="$3"
      run_monitor_loop "$RUN_DIR" "$4" "$5" "$6"
      ;;
    _logs)
      RUN_DIR="$2"
      ENV_FILE="$3"
      tail_compose_logs "$RUN_DIR"
      ;;
    ""|-h|--help|help)
      usage
      ;;
    *)
      usage
      exit 1
      ;;
  esac
}

main "$@"
