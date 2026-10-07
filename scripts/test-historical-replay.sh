#!/usr/bin/env bash
set -euo pipefail
root_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
test_root="$(mktemp -d)"
trap 'rm -rf "$test_root"' EXIT
script="$root_dir/scripts/start-historical-replay.sh"
export REPLAY_DOCKER_LOG="$test_root/docker.log"
cat > "$test_root/docker" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >> "$REPLAY_DOCKER_LOG"
if [[ "$*" == context\ inspect* ]]; then
  printf '%s\n' "${REPLAY_FAKE_ENDPOINT:-unix:///local/docker.sock}"
elif [[ "$*" == inspect* ]]; then
  [[ "${REPLAY_FAKE_MISSING:-false}" == true ]] && exit 1
  printf '%s\n' "${REPLAY_FAKE_PROJECT:-coloradotraffictracker}"
elif [[ "$*" == *' build api-service' ]]; then
  [[ "${REPLAY_FAKE_BUILD_FAILURE:-false}" == true ]] && exit 1
fi
exit 0
EOF
chmod +x "$test_root/docker"
run_replay() {
  DOCKER_HOST=unix:///local/docker.sock DOCKER_BIN="$test_root/docker" \
    SSH_CONNECTION= SSH_CLIENT= COMPOSE_PROJECT_NAME=colorado-traffic-tracker "$script"
}
expect_failure() {
  if "$@" > "$test_root/output" 2>&1; then
    printf 'Expected replay refusal.\n' >&2; exit 1
  fi
  if grep -Eq 'compose .* (build|stop|up) ' "$REPLAY_DOCKER_LOG"; then
    printf 'Refused replay mutated a container.\n' >&2; exit 1
  fi
}
bash -n "$script"
: > "$REPLAY_DOCKER_LOG"
run_replay > /dev/null
grep -Fq -- '--project-name coloradotraffictracker' "$REPLAY_DOCKER_LOG"
grep -Fq ' build api-service' "$REPLAY_DOCKER_LOG"
grep -Fq ' stop ingest-service routes-service' "$REPLAY_DOCKER_LOG"
grep -Fq ' up --no-build --no-deps -d api-service' "$REPLAY_DOCKER_LOG"
if grep -Eq 'up .*db|--project-name colorado-traffic-tracker ' "$REPLAY_DOCKER_LOG"; then
  printf 'Replay reached a database replacement or production project.\n' >&2; exit 1
fi
: > "$REPLAY_DOCKER_LOG"
REPLAY_FAKE_PROJECT=colorado-traffic-tracker expect_failure run_replay
: > "$REPLAY_DOCKER_LOG"
REPLAY_FAKE_MISSING=true expect_failure run_replay
: > "$REPLAY_DOCKER_LOG"
REPLAY_POSTGRES_DB='traffic;bad' expect_failure run_replay
: > "$REPLAY_DOCKER_LOG"
expect_failure env DOCKER_BIN="$test_root/docker" DOCKER_HOST=tcp://remote:2376 SSH_CONNECTION= SSH_CLIENT= "$script"
: > "$REPLAY_DOCKER_LOG"
expect_failure env -u DOCKER_HOST DOCKER_BIN="$test_root/docker" REPLAY_FAKE_ENDPOINT=ssh://remote SSH_CONNECTION= SSH_CLIENT= "$script"
: > "$REPLAY_DOCKER_LOG"
expect_failure env DOCKER_BIN="$test_root/docker" SSH_CONNECTION=test "$script"
: > "$REPLAY_DOCKER_LOG"
if REPLAY_FAKE_BUILD_FAILURE=true run_replay > /dev/null 2>&1; then
  printf 'Expected build failure.\n' >&2; exit 1
fi
if grep -Eq ' stop | up ' "$REPLAY_DOCKER_LOG"; then
  printf 'Failed build stopped a running local service.\n' >&2; exit 1
fi
grep -Fq 'SPRING_FLYWAY_ENABLED: "false"' "$script"
grep -Fq 'SPRING_DATASOURCE_HIKARI_READ_ONLY: "true"' "$script"
printf '[test-historical-replay] ok\n'
