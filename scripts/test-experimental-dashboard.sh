#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCRIPT="$ROOT_DIR/scripts/experimental-dashboard.sh"
COMPOSE_FILE="$ROOT_DIR/docker-compose.experimental-dashboard.yml"
DOCKERIGNORE_FILE="$ROOT_DIR/.dockerignore"
TEST_ROOT="$(mktemp -d)"
trap 'rm -rf "$TEST_ROOT"' EXIT

ENV_FILE="$TEST_ROOT/experimental.env"
DOCKER_LOG="$TEST_ROOT/docker.log"
CURL_LOG="$TEST_ROOT/curl.log"

cat > "$ENV_FILE" <<'EOF'
EXPERIMENT_DB_USERNAME=reader
SPRING_DATASOURCE_PASSWORD=test-only-placeholder
EXPERIMENT_API_SECURITY_KEYS=test-only-placeholder
EOF

cat > "$TEST_ROOT/git" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
if [[ "$*" == *"status --porcelain"* ]]; then
  [[ "${FAKE_GIT_STATUS_FAILURE:-false}" == "true" ]] && exit 1
  [[ "${FAKE_GIT_DIRTY:-false}" == "true" ]] && printf ' M dashboard.js\n'
  exit 0
fi
if [[ "$*" == *"rev-parse --verify HEAD"* ]]; then
  printf '%s\n' "${FAKE_GIT_REVISION:-0123456789abcdef0123456789abcdef01234567}"
  exit 0
fi
exit 1
EOF

cat > "$TEST_ROOT/docker" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
printf '%s|%s\n' "${EXPERIMENT_DASHBOARD_IMAGE:-}" "$*" >> "$DOCKER_LOG"
if [[ "$*" == "image inspect "* && "${FAKE_MISSING_IMAGE:-false}" == "true" ]]; then
  exit 1
fi
if [[ "$*" == *" port experimental-dashboard 8080"* ]]; then
  printf '127.0.0.1:18083\n'
fi
EOF

cat > "$TEST_ROOT/curl" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >> "$CURL_LOG"
if [[ "${FAKE_CURL_FAILURE:-false}" == "true" ]]; then
  exit 1
fi
EOF

chmod +x "$TEST_ROOT/git" "$TEST_ROOT/docker" "$TEST_ROOT/curl"

run_tool() {
  DOCKER_BIN="$TEST_ROOT/docker" \
  CURL_BIN="$TEST_ROOT/curl" \
  GIT_BIN="$TEST_ROOT/git" \
  DOCKER_LOG="$DOCKER_LOG" \
  CURL_LOG="$CURL_LOG" \
    "$SCRIPT" "$@"
}

expect_failure() {
  local expected="$1"
  shift
  local output
  if output="$("$@" 2>&1)"; then
    printf '[test-experimental-dashboard] expected failure containing %s\n' "$expected" >&2
    exit 1
  fi
  if [[ -n "$expected" ]]; then
    printf '%s' "$output" | grep -Fq "$expected"
  fi
}

bash -n "$SCRIPT"
grep -Fq 'SPRING_FLYWAY_ENABLED=false' "$COMPOSE_FILE"
grep -Fq 'SPRING_DATASOURCE_HIKARI_READ_ONLY=true' "$COMPOSE_FILE"
grep -Fq -- '- SPRING_DATASOURCE_PASSWORD' "$COMPOSE_FILE"
grep -Fq 'ROUTES_BASE_URL=http://${PRODUCTION_ROUTES_HOST:-routes-service}:8081' "$COMPOSE_FILE"
grep -Fq 'external: true' "$COMPOSE_FILE"
grep -Fq '.env.*' "$DOCKERIGNORE_FILE"
if grep -Eq 'TOMTOM|CDOT_API_KEY|ingest-service:' "$COMPOSE_FILE"; then
  printf '[test-experimental-dashboard] sidecar must not receive provider access or own ingestion\n' >&2
  exit 1
fi
run_tool start "$ENV_FILE" >/dev/null

grep -Fq 'coloradotraffictracker-api-experimental:0123456789abcdef0123456789abcdef01234567|' "$DOCKER_LOG"
grep -Fq -- '--project-name coloradotraffictracker-experimental' "$DOCKER_LOG"
grep -Fq ' config --quiet' "$DOCKER_LOG"
grep -Fq ' build experimental-dashboard' "$DOCKER_LOG"
grep -Fq 'image inspect coloradotraffictracker-api-experimental:0123456789abcdef0123456789abcdef01234567' "$DOCKER_LOG"
grep -Fq ' up -d --no-build --wait --wait-timeout 180 experimental-dashboard' "$DOCKER_LOG"
grep -Fq 'http://127.0.0.1:18083/actuator/health' "$CURL_LOG"
grep -Fq 'http://127.0.0.1:18083/actuator/health/readiness' "$CURL_LOG"
grep -Fq -- '--max-time 10' "$CURL_LOG"
grep -Fq 'http://127.0.0.1:18083/dashboard/' "$CURL_LOG"
grep -Fq 'http://127.0.0.1:18083/dashboard-api/system/operational-status' "$CURL_LOG"

run_tool stop "$ENV_FILE" >/dev/null
grep -Fq ' down --remove-orphans' "$DOCKER_LOG"

: > "$DOCKER_LOG"
EXPERIMENT_COMPOSE_PROJECT=coloradotraffictracker \
EXPERIMENT_DASHBOARD_IMAGE=coloradotraffictracker-api-service:latest \
  run_tool config "$ENV_FILE" >/dev/null
grep -Fq ' config --quiet' "$DOCKER_LOG"
grep -Fq 'coloradotraffictracker-api-experimental:0123456789abcdef0123456789abcdef01234567|' "$DOCKER_LOG"
grep -Fq -- '--project-name coloradotraffictracker-experimental' "$DOCKER_LOG"
if grep -Fq -- '--project-name coloradotraffictracker ' "$DOCKER_LOG"; then
  printf '[test-experimental-dashboard] project name override reached production project\n' >&2
  exit 1
fi
if grep -Fq 'coloradotraffictracker-api-service:latest' "$DOCKER_LOG"; then
  printf '[test-experimental-dashboard] mutable image override replaced commit tag\n' >&2
  exit 1
fi
if grep -Fq 'SPRING_DATASOURCE_PASSWORD' "$DOCKER_LOG"; then
  printf '[test-experimental-dashboard] config validation must not render secrets\n' >&2
  exit 1
fi

FAKE_GIT_DIRTY=true expect_failure 'dirty checkout' run_tool start "$ENV_FILE"
expect_failure 'environment file not found' run_tool config "$TEST_ROOT/missing.env"

: > "$DOCKER_LOG"
run_tool build "$ENV_FILE" >/dev/null
grep -Fq ' build experimental-dashboard' "$DOCKER_LOG"
if grep -Fq ' up ' "$DOCKER_LOG"; then
  printf '[test-experimental-dashboard] building must not replace the running container\n' >&2
  exit 1
fi

: > "$DOCKER_LOG"
FAKE_MISSING_IMAGE=true expect_failure 'not available locally' run_tool deploy "$ENV_FILE"
if grep -Fq ' up ' "$DOCKER_LOG"; then
  printf '[test-experimental-dashboard] missing image reached container replacement\n' >&2
  exit 1
fi

: > "$DOCKER_LOG"
expect_failure 'full lowercase commit SHA' run_tool rollback 'latest' "$ENV_FILE"
expect_failure 'full lowercase commit SHA' run_tool rollback 'coloradotraffictracker-api-service:latest' "$ENV_FILE"
FAKE_GIT_REVISION=latest expect_failure 'full lowercase commit SHA' run_tool config "$ENV_FILE"
if [[ -s "$DOCKER_LOG" ]]; then
  printf '[test-experimental-dashboard] invalid revision reached Docker\n' >&2
  exit 1
fi

: > "$DOCKER_LOG"
old_revision=fedcba9876543210fedcba9876543210fedcba98
run_tool rollback "$old_revision" "$ENV_FILE" >/dev/null
grep -Fq "image inspect coloradotraffictracker-api-experimental:$old_revision" "$DOCKER_LOG"
grep -Fq "coloradotraffictracker-api-experimental:$old_revision|compose --project-name coloradotraffictracker-experimental" "$DOCKER_LOG"
grep -Fq ' up -d --no-build --wait --wait-timeout 180 experimental-dashboard' "$DOCKER_LOG"
if grep -Eq ' build | down |api-service:latest' "$DOCKER_LOG"; then
  printf '[test-experimental-dashboard] rollback rebuilt, stopped, or selected production\n' >&2
  exit 1
fi

FAKE_CURL_FAILURE=true expect_failure '' run_tool verify "$ENV_FILE"
FAKE_GIT_DIRTY=true expect_failure 'dirty checkout' run_tool deploy "$ENV_FILE"
FAKE_GIT_DIRTY=true expect_failure 'dirty checkout' run_tool rollback "$old_revision" "$ENV_FILE"

: > "$DOCKER_LOG"
FAKE_GIT_STATUS_FAILURE=true expect_failure 'Could not verify' run_tool build "$ENV_FILE"
FAKE_GIT_STATUS_FAILURE=true expect_failure 'Could not verify' run_tool rollback "$old_revision" "$ENV_FILE"
if [[ -s "$DOCKER_LOG" ]]; then
  printf '[test-experimental-dashboard] unreadable Git state reached Docker\n' >&2
  exit 1
fi

printf '[test-experimental-dashboard] ok\n'
