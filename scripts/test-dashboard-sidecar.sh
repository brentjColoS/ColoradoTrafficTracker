#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
test_root="$(mktemp -d "${TMPDIR:-/tmp}/ctt-sidecar-test.XXXXXX")"
trap 'rm -rf "$test_root"' EXIT
export TEST_ROOT="$test_root"
mkdir -p "$test_root/bin" "$test_root/source/api-service/src/main/resources/static/dashboard"
printf 'FROM scratch\n' > "$test_root/source/api-service/Dockerfile"
printf '<script src="/dashboard/dashboard.js"></script>\n' > "$test_root/source/api-service/src/main/resources/static/dashboard/index.html"
printf 'fetch("/dashboard-api/traffic/history");\n' > "$test_root/source/api-service/src/main/resources/static/dashboard/dashboard.js"
printf 'const image="/dashboard/road-sign-i25.png";\n' > "$test_root/source/api-service/src/main/resources/static/dashboard/road-sign-display.js"
printf 'private-password=must-not-be-rendered\n' > "$test_root/sidecar.env"

cat > "$test_root/bin/git" <<'EOF'
#!/usr/bin/env bash
set -eu
printf '%s\n' "$*" >> "$TEST_ROOT/git.log"
if [[ "$*" == *" archive "* ]]; then
  tar -c -C "$TEST_ROOT/source" .
else
  printf 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\n'
fi
EOF
cat > "$test_root/bin/docker" <<'EOF'
#!/usr/bin/env bash
set -eu
printf '%s\n' "$*" >> "$TEST_ROOT/docker.log"
case "$1 $2" in
  "inspect --format") printf '%s\n' "${TEST_PREVIOUS_IMAGE:-previous-image}" ;;
  "image inspect")
    [[ -f "$TEST_ROOT/image" ]] || exit 1
    if [[ "$*" == *--format* ]]; then cat "$TEST_ROOT/image"; fi
    ;;
  "build --file")
    image=""; context="${!#}"
    for ((i=1;i<=$#;i++)); do
      if [[ "${!i}" == --tag ]]; then j=$((i+1));image="${!j}"; fi
    done
    [[ -f "$context/api-service/Dockerfile" ]]
    if [[ "$image" == *api-old:* ]]; then
      grep -Fq '/dashboard-old/' "$context/api-service/src/main/resources/static/dashboard/index.html"
      grep -Fq '/dashboard-old-api/' "$context/api-service/src/main/resources/static/dashboard/dashboard.js"
      variant=old
    else variant=experimental; fi
    sha="${image##*:}";sha="${sha%-sidecar1}"
    printf '%s|%s\n' "$sha" "$variant" > "$TEST_ROOT/image"
    printf '%s\n' "$context" > "$TEST_ROOT/build-context"
    ;;
  "compose --project-name")
    printf 'selected-image=%s\n' "$EXPERIMENT_DASHBOARD_IMAGE" >> "$TEST_ROOT/docker.log"
    if [[ "$*" == *" ps --status running "* ]]; then printf '%s' "${TEST_RUNNING_ID:-}"; fi
    if [[ "$*" == *" port "* ]]; then printf '%s\n' "${TEST_PORT:-127.0.0.1:8084}"; fi
    ;;
  *) exit 1 ;;
esac
EOF
cat > "$test_root/bin/curl" <<'EOF'
#!/usr/bin/env bash
set -eu
printf '%s\n' "$*" >> "$TEST_ROOT/curl.log"
[[ "${TEST_CURL_FAILURE:-false}" != true ]]
EOF
chmod +x "$test_root/bin/"*
export DOCKER_BIN="$test_root/bin/docker" GIT_BIN="$test_root/bin/git" CURL_BIN="$test_root/bin/curl"
script="$ROOT_DIR/scripts/dashboard-sidecar.sh"

expect_failure() {
  if "$@" > "$test_root/failure.log" 2>&1; then
    printf 'Expected sidecar operation to fail: %s\n' "$*" >&2
    exit 1
  fi
}

expect_failure "$script" production stop "$test_root/sidecar.env"
expect_failure "$script" old start "$test_root/sidecar.env"
if grep -Fq ' up ' "$test_root/docker.log"; then exit 1; fi

for variant in old experimental; do
  rm -f "$test_root/image"
  : > "$test_root/docker.log"
  "$script" "$variant" build
  if grep -Fq 'compose ' "$test_root/docker.log"; then exit 1; fi
  [[ ! -e "$(cat "$test_root/build-context")" ]]
  grep -Fq ' archive ' "$test_root/git.log"
  "$script" "$variant" start "$test_root/sidecar.env"
  "$script" "$variant" stop "$test_root/sidecar.env"
  grep -Fq 'up -d --no-build --wait' "$test_root/docker.log"
  grep -Fq 'down --remove-orphans' "$test_root/docker.log"
  if grep -Eq 'down .*--volumes|image (rm|prune)|volume |--project-name colorado-traffic-tracker ' "$test_root/docker.log"; then exit 1; fi
  "$script" "$variant" config "$test_root/sidecar.env"
  grep -Fq 'config --quiet' "$test_root/docker.log"
  before="$(wc -l < "$test_root/docker.log")"
  "$script" "$variant" build
  if tail -n +"$((before+1))" "$test_root/docker.log" | grep -Fq 'build --file'; then exit 1; fi
done

TEST_PORT=0.0.0.0:8083 expect_failure "$script" experimental verify "$test_root/sidecar.env"
TEST_CURL_FAILURE=true expect_failure "$script" experimental start "$test_root/sidecar.env"
grep -Fq 'restoring its stopped state' "$test_root/failure.log"
TEST_RUNNING_ID=previous-container TEST_PREVIOUS_IMAGE=preserved-previous-image TEST_CURL_FAILURE=true \
  expect_failure "$script" experimental start "$test_root/sidecar.env"
grep -Fq 'restoring its previous image' "$test_root/failure.log"
grep -Fq 'selected-image=preserved-previous-image' "$test_root/docker.log"
printf 'wrong-revision|experimental\n' > "$test_root/image"
expect_failure "$script" experimental start "$test_root/sidecar.env"
for variant in old experimental; do
  file="$ROOT_DIR/docker-compose.$variant-dashboard.yml"
  grep -Fq 'restart: "no"' "$file"
  grep -Fq 'SPRING_FLYWAY_ENABLED' "$file"
  if grep -Eq 'TOMTOM_|CDOT_|ingest-service:|^  db:|^  routes-service:' "$file"; then exit 1; fi
done
if grep -Fq 'must-not-be-rendered' "$test_root/docker.log"; then exit 1; fi
printf '[test-dashboard-sidecar] ok\n'
