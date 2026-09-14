#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCRIPT="$ROOT_DIR/scripts/server-health-check.sh"
TEST_ROOT="$(mktemp -d)"
trap 'rm -rf "$TEST_ROOT"' EXIT

cat > "$TEST_ROOT/curl" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

url="${*: -1}"
if [[ "$url" == *"operational-status"* ]]; then
  if [[ "${FAKE_SITE_REACHABLE:-true}" != "true" ]]; then
    printf 'connection refused\n' >&2
    exit 22
  fi
  printf '{"status":"%s","checks":[{"code":"%s","message":"%s"}]}\n' \
    "${FAKE_OPERATIONAL_STATUS:-HEALTHY}" \
    "${FAKE_OPERATIONAL_CODE:-FLOW_SAMPLE_FRESH}" \
    "${FAKE_OPERATIONAL_MESSAGE:-fresh samples}"
  exit 0
fi

printf '{"status":"%s","details":{"projectedMonthEndRequests":%s,"targetMonthlyRequests":380000}}\n' \
  "${FAKE_QUOTA_STATUS:-UP}" \
  "${FAKE_PROJECTED_REQUESTS:-357120}"
EOF

cat > "$TEST_ROOT/df" <<'EOF'
#!/usr/bin/env bash
printf 'Filesystem 1024-blocks Used Available Capacity Mounted on\n'
printf '/dev/test 100 50 50 %s%% /\n' "${FAKE_DISK_PERCENT:-50}"
EOF

cat > "$TEST_ROOT/date" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "${FAKE_NOW_EPOCH:-1788228000}"
EOF

cat > "$TEST_ROOT/stat" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "${FAKE_RECEIPT_EPOCH:-1788224400}"
EOF

chmod +x "$TEST_ROOT/curl" "$TEST_ROOT/df" "$TEST_ROOT/date" "$TEST_ROOT/stat"

run_check() {
  CURL_BIN="$TEST_ROOT/curl" \
  DF_BIN="$TEST_ROOT/df" \
  DATE_BIN="$TEST_ROOT/date" \
  STAT_BIN="$TEST_ROOT/stat" \
  PUBLIC_OPERATIONAL_STATUS_URL=https://example.test/operational-status \
  TOMTOM_QUOTA_URL=http://127.0.0.1:8082/actuator/health/quotaPressure \
  OFFSITE_BACKUP_RECEIPT_FILE="$TEST_ROOT/offsite-last-success" \
  "$SCRIPT"
}

expect_failure() {
  local expected="$1"
  shift
  local output
  if output="$("$@" 2>&1)"; then
    printf '[test-server-health-check] expected failure containing %s\n' "$expected" >&2
    exit 1
  fi
  printf '%s' "$output" | grep -Fq "$expected"
}

bash -n "$SCRIPT"
run_check | grep -Fq "healthy:"

FAKE_SITE_REACHABLE=false expect_failure "SITE_UNREACHABLE" run_check
FAKE_OPERATIONAL_STATUS=DEGRADED \
  FAKE_OPERATIONAL_CODE=FLOW_SAMPLE_STALE \
  FAKE_OPERATIONAL_MESSAGE='I70 is 61 minutes old' \
  expect_failure "FLOW_SAMPLE_STALE" run_check
FAKE_QUOTA_STATUS=DEGRADED \
  FAKE_PROJECTED_REQUESTS=401000 \
  expect_failure "TOMTOM_QUOTA_DEGRADED" run_check
FAKE_DISK_PERCENT=75 expect_failure "DISK_WARNING" run_check
FAKE_DISK_PERCENT=90 expect_failure "DISK_CRITICAL" run_check
REQUIRE_OFFSITE_BACKUP_RECEIPT=true \
  expect_failure "OFFSITE_BACKUP_MISSING" run_check

touch "$TEST_ROOT/offsite-last-success"
REQUIRE_OFFSITE_BACKUP_RECEIPT=true run_check | grep -Fq "off-site backup age 1h"
REQUIRE_OFFSITE_BACKUP_RECEIPT=true \
  FAKE_RECEIPT_EPOCH=1787536800 \
  expect_failure "OFFSITE_BACKUP_STALE" run_check

printf '[test-server-health-check] ok\n'
