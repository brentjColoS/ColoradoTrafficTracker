#!/usr/bin/env bash

set -euo pipefail

PUBLIC_OPERATIONAL_STATUS_URL="${PUBLIC_OPERATIONAL_STATUS_URL:-https://coloradotraffictracker.net/dashboard-api/system/operational-status}"
TOMTOM_QUOTA_URL="${TOMTOM_QUOTA_URL:-http://127.0.0.1:8082/actuator/health/quotaPressure}"
OFFSITE_BACKUP_RECEIPT_FILE="${OFFSITE_BACKUP_RECEIPT_FILE:-/var/lib/colorado-traffic-tracker/backups/offsite-last-success}"
REQUIRE_OFFSITE_BACKUP_RECEIPT="${REQUIRE_OFFSITE_BACKUP_RECEIPT:-false}"
MAX_OFFSITE_BACKUP_AGE_HOURS="${MAX_OFFSITE_BACKUP_AGE_HOURS:-168}"
DISK_PATH="${DISK_PATH:-/}"
DISK_WARN_PERCENT="${DISK_WARN_PERCENT:-75}"
DISK_CRITICAL_PERCENT="${DISK_CRITICAL_PERCENT:-90}"
HTTP_TIMEOUT_SECONDS="${HTTP_TIMEOUT_SECONDS:-15}"
CURL_BIN="${CURL_BIN:-curl}"
DATE_BIN="${DATE_BIN:-date}"
DF_BIN="${DF_BIN:-df}"
STAT_BIN="${STAT_BIN:-stat}"

log() {
  printf '[server-health-check] %s\n' "$*"
}

fail() {
  log "failed: $*"
  exit 1
}

whole_number() {
  [[ "$2" =~ ^[0-9]+$ ]] || fail "$1 must be a whole number"
}

json_status() {
  local payload="$1"
  local pattern='"status"[[:space:]]*:[[:space:]]*"([A-Z_]+)"'
  if [[ "$payload" =~ $pattern ]]; then
    printf '%s\n' "${BASH_REMATCH[1]}"
    return
  fi
  return 1
}

whole_number HTTP_TIMEOUT_SECONDS "$HTTP_TIMEOUT_SECONDS"
whole_number MAX_OFFSITE_BACKUP_AGE_HOURS "$MAX_OFFSITE_BACKUP_AGE_HOURS"
whole_number DISK_WARN_PERCENT "$DISK_WARN_PERCENT"
whole_number DISK_CRITICAL_PERCENT "$DISK_CRITICAL_PERCENT"
(( HTTP_TIMEOUT_SECONDS > 0 )) || fail "HTTP_TIMEOUT_SECONDS must be greater than zero"
(( DISK_WARN_PERCENT < DISK_CRITICAL_PERCENT )) \
  || fail "DISK_WARN_PERCENT must be lower than DISK_CRITICAL_PERCENT"
(( DISK_CRITICAL_PERCENT <= 100 )) \
  || fail "DISK_CRITICAL_PERCENT must not exceed 100"
[[ "$REQUIRE_OFFSITE_BACKUP_RECEIPT" == "true" || "$REQUIRE_OFFSITE_BACKUP_RECEIPT" == "false" ]] \
  || fail "REQUIRE_OFFSITE_BACKUP_RECEIPT must be true or false"

if ! operational_payload="$(
  "$CURL_BIN" -fsS --max-time "$HTTP_TIMEOUT_SECONDS" "$PUBLIC_OPERATIONAL_STATUS_URL" 2>&1
)"; then
  fail "SITE_UNREACHABLE: public operational status could not be fetched: ${operational_payload:0:500}"
fi
if ! operational_status="$(json_status "$operational_payload")"; then
  fail "OPERATIONAL_STATUS_INVALID: response did not contain a recognizable status: ${operational_payload:0:500}"
fi
if [[ "$operational_status" != "HEALTHY" ]]; then
  fail "APPLICATION_${operational_status}: $operational_payload"
fi

if ! quota_payload="$(
  "$CURL_BIN" -sS --max-time "$HTTP_TIMEOUT_SECONDS" "$TOMTOM_QUOTA_URL" 2>&1
)"; then
  fail "TOMTOM_QUOTA_UNAVAILABLE: ingest quota status could not be fetched: ${quota_payload:0:500}"
fi
if ! quota_status="$(json_status "$quota_payload")"; then
  fail "TOMTOM_QUOTA_INVALID: response did not contain a recognizable status: ${quota_payload:0:500}"
fi
if [[ "$quota_status" != "UP" ]]; then
  fail "TOMTOM_QUOTA_${quota_status}: $quota_payload"
fi

disk_percent="$(
  "$DF_BIN" -P "$DISK_PATH" \
    | awk 'NR == 2 {value=$5; gsub(/%/, "", value); print value}'
)"
whole_number disk_percent "$disk_percent"
if (( disk_percent >= DISK_CRITICAL_PERCENT )); then
  fail "DISK_CRITICAL: $DISK_PATH is ${disk_percent}% full; the critical threshold is ${DISK_CRITICAL_PERCENT}%"
fi
if (( disk_percent >= DISK_WARN_PERCENT )); then
  fail "DISK_WARNING: $DISK_PATH is ${disk_percent}% full; the warning threshold is ${DISK_WARN_PERCENT}%"
fi

backup_summary="off-site receipt not required"
if [[ "$REQUIRE_OFFSITE_BACKUP_RECEIPT" == "true" ]]; then
  [[ -f "$OFFSITE_BACKUP_RECEIPT_FILE" ]] \
    || fail "OFFSITE_BACKUP_MISSING: no verified Windows backup receipt exists at $OFFSITE_BACKUP_RECEIPT_FILE"
  current_epoch="$("$DATE_BIN" -u +%s)"
  receipt_epoch="$("$STAT_BIN" -c %Y "$OFFSITE_BACKUP_RECEIPT_FILE")"
  whole_number current_epoch "$current_epoch"
  whole_number receipt_epoch "$receipt_epoch"
  backup_age_hours="$(( (current_epoch - receipt_epoch) / 3600 ))"
  (( backup_age_hours < 0 )) && backup_age_hours=0
  if (( backup_age_hours > MAX_OFFSITE_BACKUP_AGE_HOURS )); then
    fail "OFFSITE_BACKUP_STALE: the last verified Windows backup is ${backup_age_hours} hours old; the threshold is ${MAX_OFFSITE_BACKUP_AGE_HOURS} hours"
  fi
  backup_summary="off-site backup age ${backup_age_hours}h"
fi

log "healthy: application=$operational_status tomtomQuota=$quota_status disk=${disk_percent}% $backup_summary"
