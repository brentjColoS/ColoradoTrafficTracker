#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STATE_DIR="$ROOT_DIR/.local/compose-health-watchdog"
PID_FILE="$STATE_DIR/watchdog.pid"
LOG_FILE="$STATE_DIR/watchdog.log"

usage() {
  cat <<'EOF'
Usage:
  ./scripts/compose-health-watchdog.sh run [env-file]
  ./scripts/compose-health-watchdog.sh start [env-file]
  ./scripts/compose-health-watchdog.sh stop
  ./scripts/compose-health-watchdog.sh status

Environment:
  COMPOSE_HEALTH_WATCHDOG_SERVICES="api-service ingest-service routes-service"
  COMPOSE_HEALTH_WATCHDOG_INTERVAL_SECONDS=30
  COMPOSE_HEALTH_WATCHDOG_FAILURES=3
  COMPOSE_HEALTH_WATCHDOG_COOLDOWN_SECONDS=180

Behavior:
  Watches Docker health status for the configured Compose services. A service
  that stays unhealthy for the configured number of checks is restarted with
  `docker compose restart <service>`, then placed on cooldown.
EOF
}

log() {
  printf '[compose-health-watchdog] %s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"
}

fail() {
  log "$*" >&2
  exit 1
}

ensure_state_dir() {
  mkdir -p "$STATE_DIR"
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

load_env_file() {
  local env_file="$1"
  [[ -f "$env_file" ]] || fail "Env file not found: $env_file"
  while IFS='=' read -r key value; do
    [[ "$key" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || continue
    case "$key" in
      COMPOSE_HEALTH_WATCHDOG_*)
        export "$key=$value"
        ;;
    esac
  done < <(sed -n '/^[[:space:]]*#/d; /^[[:space:]]*$/d; p' "$env_file")
}

compose() {
  APP_ENV_FILE="$ENV_FILE" docker compose --env-file "$ENV_FILE" "$@"
}

pid_alive() {
  local pid="${1:-}"
  [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null
}

current_pid() {
  [[ -f "$PID_FILE" ]] || return 0
  sed -n '1p' "$PID_FILE"
}

health_status() {
  local service="$1"
  local container_id
  container_id="$(compose ps -q "$service")"
  if [[ -z "$container_id" ]]; then
    printf 'missing\n'
    return
  fi

  docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$container_id" 2>/dev/null || printf 'missing\n'
}

run_watchdog() {
  local interval_seconds="${COMPOSE_HEALTH_WATCHDOG_INTERVAL_SECONDS:-30}"
  local failure_threshold="${COMPOSE_HEALTH_WATCHDOG_FAILURES:-3}"
  local cooldown_seconds="${COMPOSE_HEALTH_WATCHDOG_COOLDOWN_SECONDS:-180}"
  local services="${COMPOSE_HEALTH_WATCHDOG_SERVICES:-api-service ingest-service routes-service}"
  declare -A failures=()
  declare -A restarted_at=()

  [[ "$interval_seconds" =~ ^[0-9]+$ ]] || fail "COMPOSE_HEALTH_WATCHDOG_INTERVAL_SECONDS must be a whole number"
  [[ "$failure_threshold" =~ ^[0-9]+$ ]] || fail "COMPOSE_HEALTH_WATCHDOG_FAILURES must be a whole number"
  [[ "$cooldown_seconds" =~ ^[0-9]+$ ]] || fail "COMPOSE_HEALTH_WATCHDOG_COOLDOWN_SECONDS must be a whole number"
  (( interval_seconds > 0 )) || fail "COMPOSE_HEALTH_WATCHDOG_INTERVAL_SECONDS must be greater than zero"
  (( failure_threshold > 0 )) || fail "COMPOSE_HEALTH_WATCHDOG_FAILURES must be greater than zero"

  trap 'log "stopping"; exit 0' INT TERM
  log "watching services: $services"

  while true; do
    local now
    now="$(date +%s)"

    for service in $services; do
      local status
      status="$(health_status "$service")"

      case "$status" in
        healthy|starting)
          failures["$service"]=0
          ;;
        unhealthy|missing)
          failures["$service"]=$(( ${failures["$service"]:-0} + 1 ))
          log "$service health=$status failures=${failures["$service"]}/$failure_threshold"
          if (( failures["$service"] >= failure_threshold )); then
            local last_restart="${restarted_at["$service"]:-0}"
            if (( now - last_restart >= cooldown_seconds )); then
              log "restarting $service after repeated unhealthy checks"
              compose restart "$service"
              restarted_at["$service"]="$now"
              failures["$service"]=0
            else
              log "$service still unhealthy but restart is cooling down"
            fi
          fi
          ;;
        none)
          log "$service has no Docker healthcheck; skipping"
          failures["$service"]=0
          ;;
        *)
          failures["$service"]=$(( ${failures["$service"]:-0} + 1 ))
          log "$service health=$status failures=${failures["$service"]}/$failure_threshold"
          ;;
      esac
    done

    sleep "$interval_seconds"
  done
}

start_watchdog() {
  ensure_state_dir
  local pid
  pid="$(current_pid || true)"
  if pid_alive "$pid"; then
    fail "Watchdog already running with PID $pid"
  fi

  nohup "$0" run "$ENV_FILE" >> "$LOG_FILE" 2>&1 &
  printf '%s\n' "$!" > "$PID_FILE"
  log "started with PID $(cat "$PID_FILE"); logs: $LOG_FILE"
}

stop_watchdog() {
  local pid
  pid="$(current_pid || true)"
  if ! pid_alive "$pid"; then
    rm -f "$PID_FILE"
    log "not running"
    return
  fi

  kill "$pid"
  rm -f "$PID_FILE"
  log "stopped PID $pid"
}

status_watchdog() {
  local pid
  pid="$(current_pid || true)"
  if pid_alive "$pid"; then
    log "running with PID $pid; logs: $LOG_FILE"
  else
    log "not running"
  fi
}

main() {
  local command="${1:-}"
  shift || true

  case "$command" in
    run|start)
      ENV_FILE="$(resolve_env_file "${1:-}")"
      load_env_file "$ENV_FILE"
      ;;
  esac

  case "$command" in
    run)
      run_watchdog
      ;;
    start)
      start_watchdog
      ;;
    stop)
      stop_watchdog
      ;;
    status)
      status_watchdog
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
