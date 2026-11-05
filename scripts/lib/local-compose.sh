#!/usr/bin/env bash

# Callers supply ROOT_DIR; environment files remain loaded by each caller.
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
  local preferred_file="$2"
  local fallback_file="$3"
  if [[ -n "$requested" ]]; then
    resolve_path "$requested"
  elif [[ -n "${APP_ENV_FILE:-}" ]]; then
    resolve_path "$APP_ENV_FILE"
  elif [[ -f "$ROOT_DIR/$preferred_file" ]]; then
    printf '%s\n' "$ROOT_DIR/$preferred_file"
  else
    printf '%s\n' "$ROOT_DIR/$fallback_file"
  fi
}

pid_alive() {
  local pid="${1:-}"
  [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null
}
