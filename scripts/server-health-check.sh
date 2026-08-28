#!/usr/bin/env bash

set -euo pipefail

PUBLIC_SUMMARY_URL="${PUBLIC_SUMMARY_URL:-https://coloradotraffictracker.net/dashboard-api/traffic/summary?corridor=I25&windowHours=24&preferUsable=true}"
INGEST_READINESS_URL="${INGEST_READINESS_URL:-http://127.0.0.1:8082/actuator/health/readiness}"
MAX_SAMPLE_AGE_MINUTES="${MAX_SAMPLE_AGE_MINUTES:-5}"
HTTP_TIMEOUT_SECONDS="${HTTP_TIMEOUT_SECONDS:-10}"
CURL_BIN="${CURL_BIN:-curl}"

log() {
  printf '[server-health-check] %s\n' "$*"
}

fail() {
  log "failed: $*"
  exit 1
}

[[ "$MAX_SAMPLE_AGE_MINUTES" =~ ^[0-9]+$ ]] \
  || fail "MAX_SAMPLE_AGE_MINUTES must be a whole number"
[[ "$HTTP_TIMEOUT_SECONDS" =~ ^[0-9]+$ ]] \
  || fail "HTTP_TIMEOUT_SECONDS must be a whole number"
(( HTTP_TIMEOUT_SECONDS > 0 )) \
  || fail "HTTP_TIMEOUT_SECONDS must be greater than zero"

summary="$("$CURL_BIN" -fsS --max-time "$HTTP_TIMEOUT_SECONDS" "$PUBLIC_SUMMARY_URL")" \
  || fail "public traffic summary is unavailable"
sample_age="$(
  printf '%s' "$summary" \
    | sed -n 's/.*"sampleAgeMinutes":[[:space:]]*\([0-9][0-9]*\).*/\1/p' \
    | head -n 1
)"

[[ -n "$sample_age" ]] || fail "public traffic summary has no sample age"
(( sample_age <= MAX_SAMPLE_AGE_MINUTES )) \
  || fail "latest flow sample is ${sample_age} minutes old"

"$CURL_BIN" -fsS --max-time "$HTTP_TIMEOUT_SECONDS" "$INGEST_READINESS_URL" >/dev/null \
  || fail "ingest is out of service"

log "healthy: public summary available, flow sample age ${sample_age}m, ingest ready"
