#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCRIPT="$ROOT_DIR/scripts/server-health-check.sh"
TEMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TEMP_DIR"' EXIT

cat > "$TEMP_DIR/curl" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

url="${*: -1}"
if [[ "$url" == *"/actuator/health/readiness" ]]; then
  if [[ "${FAKE_INGEST_READY:-true}" != "true" ]]; then
    exit 22
  fi
  printf '{"status":"UP"}\n'
  exit 0
fi

printf '{"sampleAgeMinutes":%s}\n' "${FAKE_SAMPLE_AGE:-1}"
EOF
chmod +x "$TEMP_DIR/curl"

run_check() {
  CURL_BIN="$TEMP_DIR/curl" \
    PUBLIC_SUMMARY_URL=https://example.test/summary \
    INGEST_READINESS_URL=http://127.0.0.1:8082/actuator/health/readiness \
    MAX_SAMPLE_AGE_MINUTES=5 \
    "$SCRIPT"
}

bash -n "$SCRIPT"

run_check | grep -Fq "healthy:"

if FAKE_SAMPLE_AGE=6 run_check >/dev/null 2>&1; then
  printf '[test-server-health-check] expected stale data to fail\n' >&2
  exit 1
fi

if FAKE_INGEST_READY=false run_check >/dev/null 2>&1; then
  printf '[test-server-health-check] expected unavailable ingest to fail\n' >&2
  exit 1
fi

printf '[test-server-health-check] ok\n'
