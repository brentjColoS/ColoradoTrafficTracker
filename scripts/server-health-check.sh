#!/usr/bin/env bash

set -euo pipefail

PUBLIC_OPERATIONAL_STATUS_URL="${PUBLIC_OPERATIONAL_STATUS_URL:-https://coloradotraffictracker.net/dashboard-api/system/operational-status}"
TOMTOM_QUOTA_URL="${TOMTOM_QUOTA_URL:-http://127.0.0.1:8082/actuator/health/quotaPressure}"
OFFSITE_BACKUP_RECEIPT_FILE="${OFFSITE_BACKUP_RECEIPT_FILE:-/var/lib/colorado-traffic-tracker/backups/offsite-last-success}"
REQUIRE_OFFSITE_BACKUP_RECEIPT="${REQUIRE_OFFSITE_BACKUP_RECEIPT:-false}"
MAX_OFFSITE_BACKUP_AGE_HOURS="${MAX_OFFSITE_BACKUP_AGE_HOURS:-192}"
DISK_PATH="${DISK_PATH:-/}"
DISK_WARN_FREE_GB="${DISK_WARN_FREE_GB:-10}"
DISK_CRITICAL_PERCENT="${DISK_CRITICAL_PERCENT:-90}"
HTTP_TIMEOUT_SECONDS="${HTTP_TIMEOUT_SECONDS:-15}"
CURL_BIN="${CURL_BIN:-curl}"
DATE_BIN="${DATE_BIN:-date}"
DF_BIN="${DF_BIN:-df}"

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
whole_number DISK_WARN_FREE_GB "$DISK_WARN_FREE_GB"
whole_number DISK_CRITICAL_PERCENT "$DISK_CRITICAL_PERCENT"
(( HTTP_TIMEOUT_SECONDS > 0 )) || fail "HTTP_TIMEOUT_SECONDS must be greater than zero"
(( DISK_WARN_FREE_GB > 0 )) || fail "DISK_WARN_FREE_GB must be greater than zero"
(( DISK_CRITICAL_PERCENT > 0 && DISK_CRITICAL_PERCENT <= 100 )) \
  || fail "DISK_CRITICAL_PERCENT must be between 1 and 100"
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

disk_usage="$(
  "$DF_BIN" -Pk "$DISK_PATH" \
    | awk 'NR == 2 {value=$5; gsub(/%/, "", value); print value, $4}'
)"
read -r disk_percent disk_available_kib <<< "$disk_usage"
whole_number disk_percent "$disk_percent"
whole_number disk_available_kib "$disk_available_kib"
disk_available_bytes="$((disk_available_kib * 1024))"
disk_available_gb="$(awk -v bytes="$disk_available_bytes" 'BEGIN {printf "%.2f", bytes / 1000000000}')"
if (( disk_percent >= DISK_CRITICAL_PERCENT )); then
  fail "DISK_CRITICAL: $DISK_PATH is ${disk_percent}% full with ${disk_available_gb} GB available; the critical threshold is ${DISK_CRITICAL_PERCENT}%. Expand storage or review non-database disk use; no traffic history has been removed by this check."
fi
if (( disk_available_bytes <= DISK_WARN_FREE_GB * 1000000000 )); then
  fail "DISK_WARNING: $DISK_PATH has ${disk_available_gb} GB available; the warning threshold is ${DISK_WARN_FREE_GB} GB. Expand storage or review non-database disk use; no traffic history has been removed by this check."
fi

backup_summary="off-site receipt not required"
if [[ "$REQUIRE_OFFSITE_BACKUP_RECEIPT" == "true" ]]; then
  [[ -f "$OFFSITE_BACKUP_RECEIPT_FILE" ]] \
    || fail "OFFSITE_BACKUP_MISSING: no verified Windows backup receipt exists at $OFFSITE_BACKUP_RECEIPT_FILE"
  receipt_backup="$(awk -F= '$1 == "backup_file" {print substr($0, index($0, "=") + 1); exit}' "$OFFSITE_BACKUP_RECEIPT_FILE")"
  [[ "$receipt_backup" =~ ^traffic-([0-9]{8})T([0-9]{6})Z\.dump$ ]] \
    || fail "OFFSITE_BACKUP_RECEIPT_INVALID: the receipt does not identify a valid backup filename"
  backup_date="${BASH_REMATCH[1]}"
  backup_time="${BASH_REMATCH[2]}"
  backup_date_utc="${backup_date:0:4}-${backup_date:4:2}-${backup_date:6:2} ${backup_time:0:2}:${backup_time:2:2}:${backup_time:4:2} UTC"
  if ! backup_epoch="$("$DATE_BIN" -u -d "$backup_date_utc" +%s 2>/dev/null)"; then
    fail "OFFSITE_BACKUP_RECEIPT_INVALID: the receipt backup timestamp is not a real UTC date"
  fi
  current_epoch="$("$DATE_BIN" -u +%s)"
  whole_number current_epoch "$current_epoch"
  whole_number backup_epoch "$backup_epoch"
  backup_age_hours="$(( (current_epoch - backup_epoch) / 3600 ))"
  (( backup_age_hours < 0 )) && backup_age_hours=0
  if (( backup_age_hours > MAX_OFFSITE_BACKUP_AGE_HOURS )); then
    fail "OFFSITE_BACKUP_STALE: the newest verified Windows backup $receipt_backup is ${backup_age_hours} hours old; the threshold is ${MAX_OFFSITE_BACKUP_AGE_HOURS} hours"
  fi
  backup_summary="off-site backup $receipt_backup age ${backup_age_hours}h"
fi

log "healthy: application=$operational_status tomtomQuota=$quota_status disk=${disk_percent}% available=${disk_available_gb}GB $backup_summary"
