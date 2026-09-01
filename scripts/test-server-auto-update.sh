#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
UPDATER="$ROOT_DIR/scripts/server-auto-update.sh"
TEST_DIR="$(mktemp -d)"
trap 'rm -rf "$TEST_DIR"' EXIT

fail() {
  printf 'FAIL: %s\n' "$*" >&2
  exit 1
}

assert_contains() {
  local expected="$1"
  local file="$2"
  grep -Fq -- "$expected" "$file" || fail "expected '$expected' in $file"
}

assert_not_contains() {
  local unexpected="$1"
  local file="$2"
  if grep -Fq -- "$unexpected" "$file"; then
    fail "did not expect '$unexpected' in $file"
  fi
}

FAKE_BIN="$TEST_DIR/bin"
mkdir -p "$FAKE_BIN"

cat >"$FAKE_BIN/fake-command" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

command_name="$(basename "$0")"

case "$command_name" in
  curl)
    url="${!#}"
    case "$url" in
      *actuator/health/readiness)
        printf '{"status":"UP"}\n'
        ;;
      *corridor=I25*)
        corridor="I25"
        base_id=100
        ;;
      *corridor=I70*)
        corridor="I70"
        base_id=200
        ;;
      *operational-status)
        printf '{"status":"HEALTHY","summary":"All monitored systems are current"}\n'
        ;;
      *)
        exit 22
        ;;
    esac

    if [[ "${corridor:-}" == "I70" && "$TEST_SCENARIO" == "preflight-failure" ]]; then
      exit 22
    fi
    if [[ -n "${corridor:-}" ]]; then
      counter_file="$TEST_STATE_DIR/${corridor}.count"
      count=0
      if [[ -f "$counter_file" ]]; then
        read -r count <"$counter_file"
      fi
      count=$((count + 1))
      printf '%s\n' "$count" >"$counter_file"
      sample_id="$base_id"
      if [[ "$TEST_SCENARIO" == "success" && "$count" -ge 3 ]]; then
        sample_id=$((base_id + 1))
      fi
      printf '{"id":%s,"corridor":"%s"}\n' "$sample_id" "$corridor"
    fi
    ;;
  git)
    printf 'git %s\n' "$*" >>"$TEST_CALL_LOG"
    case "$*" in
      "rev-parse HEAD") printf 'old-sha\n' ;;
      "rev-parse origin/main") printf 'new-sha\n' ;;
    esac
    ;;
  docker)
    printf 'docker %s\n' "$*" >>"$TEST_CALL_LOG"
    ;;
  flock)
    exit 0
    ;;
  logger)
    printf 'logger %s\n' "$*" >>"$TEST_CALL_LOG"
    ;;
  sleep)
    /bin/sleep 0.05
    ;;
  *)
    exit 1
    ;;
esac
EOF
chmod +x "$FAKE_BIN/fake-command"
for command_name in curl git docker flock logger sleep; do
  ln -s fake-command "$FAKE_BIN/$command_name"
done

run_updater() {
  local scenario="$1"
  local case_dir="$TEST_DIR/$scenario"
  mkdir -p "$case_dir/app" "$case_dir/state"
  : >"$case_dir/app/.env.cloud"
  : >"$case_dir/calls.log"

  APP_DIR="$case_dir/app" \
  LOCK_FILE="$case_dir/update.lock" \
  CURL_BIN="$FAKE_BIN/curl" \
  DOCKER_BIN="$FAKE_BIN/docker" \
  FLOCK_BIN="$FAKE_BIN/flock" \
  GIT_BIN="$FAKE_BIN/git" \
  LOGGER_BIN="$FAKE_BIN/logger" \
  SLEEP_BIN="$FAKE_BIN/sleep" \
  HEALTH_TIMEOUT_SECONDS=1 \
  INGEST_PROGRESS_TIMEOUT_SECONDS=1 \
  POLL_INTERVAL_SECONDS=1 \
  TEST_SCENARIO="$scenario" \
  TEST_STATE_DIR="$case_dir/state" \
  TEST_CALL_LOG="$case_dir/calls.log" \
  "$UPDATER"
}

run_updater success
SUCCESS_LOG="$TEST_DIR/success/calls.log"
assert_contains "git merge --ff-only origin/main" "$SUCCESS_LOG"
assert_contains "docker compose --env-file .env.cloud up -d --build --remove-orphans" "$SUCCESS_LOG"
assert_contains "updated successfully to new-sha after both corridors produced new samples" "$SUCCESS_LOG"
[[ "$(grep -Fc 'docker compose' "$SUCCESS_LOG")" -eq 1 ]] || fail "successful update should rebuild once"

if run_updater stalled-ingest; then
  fail "stalled ingest should fail deployment verification"
fi
STALLED_LOG="$TEST_DIR/stalled-ingest/calls.log"
assert_contains "live ingest verification timed out" "$STALLED_LOG"
assert_contains "git reset --hard old-sha" "$STALLED_LOG"
[[ "$(grep -Fc 'docker compose' "$STALLED_LOG")" -eq 2 ]] || fail "failed update should rebuild the rollback"

if run_updater preflight-failure; then
  fail "missing current corridor data should stop the update"
fi
PREFLIGHT_LOG="$TEST_DIR/preflight-failure/calls.log"
assert_contains "current corridor data is unavailable; aborting auto-update before changing the checkout" "$PREFLIGHT_LOG"
assert_not_contains "git checkout main" "$PREFLIGHT_LOG"
assert_not_contains "docker compose" "$PREFLIGHT_LOG"

printf 'server auto-update tests passed\n'
