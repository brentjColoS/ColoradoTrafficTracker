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
[[ "$1" == "-Pk" ]] || exit 1
printf 'Filesystem 1024-blocks Used Available Capacity Mounted on\n'
printf '/dev/test 80000000 30000000 %s %s%% /\n' "${FAKE_DISK_AVAILABLE_KIB:-45000000}" "${FAKE_DISK_PERCENT:-50}"
EOF

cat > "$TEST_ROOT/date" <<'EOF'
#!/usr/bin/env bash
if [[ "$*" == *"-d"* ]]; then
  if [[ "$*" == *"2026-02-31"* ]]; then
    exit 1
  fi
  printf '%s\n' "${FAKE_BACKUP_EPOCH:-1788224400}"
else
  printf '%s\n' "${FAKE_NOW_EPOCH:-1788228000}"
fi
EOF

chmod +x "$TEST_ROOT/curl" "$TEST_ROOT/df" "$TEST_ROOT/date"

run_check() {
  CURL_BIN="$TEST_ROOT/curl" \
  DF_BIN="$TEST_ROOT/df" \
  DATE_BIN="$TEST_ROOT/date" \
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
FAKE_DISK_PERCENT=80 run_check | grep -Fq "healthy:"
FAKE_DISK_AVAILABLE_KIB=9765626 run_check | grep -Fq "healthy:"
FAKE_DISK_AVAILABLE_KIB=9765625 \
  expect_failure "10.00 GB available; the warning threshold is 10 GB" run_check
FAKE_DISK_AVAILABLE_KIB=9000000 expect_failure "DISK_WARNING" run_check
FAKE_DISK_AVAILABLE_KIB=0 expect_failure "DISK_WARNING" run_check
DISK_WARN_FREE_GB=20 FAKE_DISK_AVAILABLE_KIB=15000000 \
  expect_failure "the warning threshold is 20 GB" run_check
DISK_WARN_FREE_GB=0 expect_failure "DISK_WARN_FREE_GB must be greater than zero" run_check
FAKE_DISK_AVAILABLE_KIB=invalid expect_failure "disk_available_kib must be a whole number" run_check
FAKE_DISK_PERCENT=90 expect_failure "DISK_CRITICAL" run_check
REQUIRE_OFFSITE_BACKUP_RECEIPT=true \
  expect_failure "OFFSITE_BACKUP_MISSING" run_check

cat > "$TEST_ROOT/offsite-last-success" <<'EOF'
completed_at=2026-09-01T00:00:00Z
backup_file=traffic-20260831T033000Z.dump
sha256=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
EOF
REQUIRE_OFFSITE_BACKUP_RECEIPT=true run_check | grep -Fq "off-site backup traffic-20260831T033000Z.dump age 1h"
REQUIRE_OFFSITE_BACKUP_RECEIPT=true \
  FAKE_BACKUP_EPOCH=1787533200 \
  expect_failure "OFFSITE_BACKUP_STALE" run_check

cat > "$TEST_ROOT/offsite-last-success" <<'EOF'
completed_at=2026-09-01T00:00:00Z
backup_file=traffic-20260231T033000Z.dump
sha256=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
EOF
REQUIRE_OFFSITE_BACKUP_RECEIPT=true \
  expect_failure "OFFSITE_BACKUP_RECEIPT_INVALID" run_check

printf '[test-server-health-check] ok\n'
