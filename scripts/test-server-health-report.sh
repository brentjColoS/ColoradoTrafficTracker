#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCRIPT="$ROOT_DIR/scripts/server-health-report.sh"
TEST_ROOT="$(mktemp -d)"
trap 'rm -rf "$TEST_ROOT"' EXIT

cat > "$TEST_ROOT/health-check" <<'EOF'
#!/usr/bin/env bash
if [[ "${FAKE_CHECK_STATUS:-0}" != "0" ]]; then
  printf '[server-health-check] failed: FLOW_SAMPLE_STALE: I70 is 61 minutes old\n'
  exit "$FAKE_CHECK_STATUS"
fi
printf '[server-health-check] healthy: all checks passed\n'
EOF

cat > "$TEST_ROOT/curl" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "${*: -1}" > "$FAKE_CURL_URL_FILE"
for ((index = 1; index <= $#; index++)); do
  if [[ "${!index}" == "--data-binary" ]]; then
    next=$((index + 1))
    printf '%s\n' "${!next}" > "$FAKE_CURL_BODY_FILE"
    break
  fi
done
EOF

chmod +x "$TEST_ROOT/health-check" "$TEST_ROOT/curl"

run_report() {
  HEALTH_CHECK_SCRIPT="$TEST_ROOT/health-check" \
  HEALTHCHECKS_PING_URL=https://hc-ping.example.test/check-id \
  CURL_BIN="$TEST_ROOT/curl" \
  FAKE_CURL_URL_FILE="$TEST_ROOT/url" \
  FAKE_CURL_BODY_FILE="$TEST_ROOT/body" \
  "$SCRIPT"
}

bash -n "$SCRIPT"
run_report | grep -Fq "heartbeat delivered"
grep -Fxq 'https://hc-ping.example.test/check-id' "$TEST_ROOT/url"
grep -Fq 'exit_status=0' "$TEST_ROOT/body"

if FAKE_CHECK_STATUS=1 run_report >/dev/null 2>&1; then
  printf '[test-server-health-report] expected failed health check to return failure\n' >&2
  exit 1
fi
grep -Fxq 'https://hc-ping.example.test/check-id/fail' "$TEST_ROOT/url"
grep -Fq 'FLOW_SAMPLE_STALE' "$TEST_ROOT/body"

printf '[test-server-health-report] ok\n'
