#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TEST_DIR="$(mktemp -d "${TMPDIR:-/tmp}/ctt-container-cache.XXXXXX")"
trap 'rm -rf "$TEST_DIR"' EXIT
mkdir "$TEST_DIR/context"
cd "$ROOT_DIR"
git ls-files -z | tar --null -T - -cf - | tar -xf - -C "$TEST_DIR/context"

build() {
  local service="$1" label="$2"
  docker build --target build --progress plain -f "$service/Dockerfile" \
    "$TEST_DIR/context" > "$TEST_DIR/$service-$label.log" 2>&1 || {
      tail -n 60 "$TEST_DIR/$service-$label.log"
      return 1
    }
}

expect_step() {
  local service="$1" label="$2" goal="$3" expected="$4"
  local log="$TEST_DIR/$service-$label.log"
  if ! awk -v goal="$goal" -v expected="$expected" '
    / RUN mvn / && index($0, goal) { step=$1; found=1; next }
    found && $1 == step && $2 == expected { matched=1 }
    END { exit !matched }
  ' "$log"; then
    echo "Expected $service $goal to be $expected after $label" >&2
    tail -n 60 "$log" >&2
    return 1
  fi
}

for service in routes-service ingest-service api-service; do
  build "$service" baseline
done
docker build --target dependencies --provenance=false -f api-service/Dockerfile \
  --iidfile "$TEST_DIR/dependencies-before" "$TEST_DIR/context" \
  > "$TEST_DIR/dependencies-before.log" 2>&1

printf 'Unrelated context change\n' > "$TEST_DIR/context/cache-probe.md"
printf 'API-only resource: %s\n' "$TEST_DIR" > "$TEST_DIR/context/api-service/src/main/resources/cache-probe.txt"
for service in routes-service ingest-service; do
  build "$service" unrelated
  expect_step "$service" unrelated package CACHED
done
build api-service changed
expect_step api-service changed dependency:go-offline CACHED
expect_step api-service changed package DONE

mkdir -p "$TEST_DIR/context/common/src/main/resources"
printf 'Shared resource: %s\n' "$TEST_DIR" > "$TEST_DIR/context/common/src/main/resources/cache-probe.txt"
for service in routes-service ingest-service; do
  build "$service" shared
  expect_step "$service" shared dependency:go-offline CACHED
  expect_step "$service" shared package DONE
done
docker build --target dependencies --provenance=false -f api-service/Dockerfile \
  --iidfile "$TEST_DIR/dependencies-after" "$TEST_DIR/context" \
  > "$TEST_DIR/dependencies-after.log" 2>&1
cmp "$TEST_DIR/dependencies-before" "$TEST_DIR/dependencies-after"

echo 'Container cache isolation passed: unrelated inputs stay cached; owned/shared inputs rebuild; dependency export stays unchanged.'
