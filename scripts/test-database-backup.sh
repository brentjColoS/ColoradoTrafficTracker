#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TEST_ROOT="$(mktemp -d)"
trap 'rm -rf "$TEST_ROOT"' EXIT

mkdir -p "$TEST_ROOT/bin" "$TEST_ROOT/limited-backups" "$TEST_ROOT/unlimited-backups" "$TEST_ROOT/receipts"

cat > "$TEST_ROOT/test.env" <<'EOF'
POSTGRES_USER=traffic_test
POSTGRES_DB=traffic_test
EOF

cat > "$TEST_ROOT/bin/docker" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
if [[ "$*" == *"pg_dump"* ]]; then
  printf 'test custom dump\n'
  exit 0
fi
if [[ "$*" == *"pg_restore --list"* ]]; then
  cat >/dev/null
  exit 0
fi
exit 1
EOF

cat > "$TEST_ROOT/bin/date" <<EOF
#!/usr/bin/env bash
set -euo pipefail
counter_file='$TEST_ROOT/date-counter'
counter=0
if [[ -f "\$counter_file" ]]; then
  counter="\$(cat "\$counter_file")"
fi
counter=\$((counter + 1))
printf '%s\n' "\$counter" > "\$counter_file"
printf '202608%02dT033000Z\n' "\$counter"
EOF

cat > "$TEST_ROOT/bin/sha256sum" <<'EOF'
#!/usr/bin/env bash
printf 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa  %s\n' "$1"
EOF

chmod +x "$TEST_ROOT/bin/docker" "$TEST_ROOT/bin/date" "$TEST_ROOT/bin/sha256sum"

run_backup() {
  local backup_dir="$1"
  local retention_count="$2"
  DATABASE_BACKUP_DIR="$backup_dir" \
  DATABASE_BACKUP_RETENTION_COUNT="$retention_count" \
  DOCKER_BIN="$TEST_ROOT/bin/docker" \
  DATE_BIN="$TEST_ROOT/bin/date" \
  SHA256_BIN="$TEST_ROOT/bin/sha256sum" \
    "$ROOT_DIR/scripts/backups/create-database-backup.sh" "$TEST_ROOT/test.env" >/dev/null
}

for _ in 1 2 3; do
  run_backup "$TEST_ROOT/limited-backups" 2
done

backup_count="$(find "$TEST_ROOT/limited-backups" -type f -name 'traffic-*.dump' | wc -l | tr -d ' ')"
manifest_count="$(find "$TEST_ROOT/limited-backups" -type f -name 'traffic-*.dump.sha256' | wc -l | tr -d ' ')"
[[ "$backup_count" == "2" ]] || { printf 'expected 2 retained dumps, found %s\n' "$backup_count" >&2; exit 1; }
[[ "$manifest_count" == "2" ]] || { printf 'expected 2 retained manifests, found %s\n' "$manifest_count" >&2; exit 1; }
[[ ! -e "$TEST_ROOT/limited-backups/traffic-20260801T033000Z.dump" ]] || { printf 'oldest dump was not removed\n' >&2; exit 1; }

for _ in 1 2 3; do
  run_backup "$TEST_ROOT/unlimited-backups" 0
done

backup_count="$(find "$TEST_ROOT/unlimited-backups" -type f -name 'traffic-*.dump' | wc -l | tr -d ' ')"
manifest_count="$(find "$TEST_ROOT/unlimited-backups" -type f -name 'traffic-*.dump.sha256' | wc -l | tr -d ' ')"
[[ "$backup_count" == "3" ]] || { printf 'expected all 3 unlimited dumps, found %s\n' "$backup_count" >&2; exit 1; }
[[ "$manifest_count" == "3" ]] || { printf 'expected all 3 unlimited manifests, found %s\n' "$manifest_count" >&2; exit 1; }

if DATABASE_BACKUP_DIR="$TEST_ROOT/invalid-backups" \
  DATABASE_BACKUP_RETENTION_COUNT=-1 \
  DOCKER_BIN="$TEST_ROOT/bin/docker" \
  DATE_BIN="$TEST_ROOT/bin/date" \
  SHA256_BIN="$TEST_ROOT/bin/sha256sum" \
    "$ROOT_DIR/scripts/backups/create-database-backup.sh" "$TEST_ROOT/test.env" >/dev/null 2>&1; then
  printf 'negative retention count was accepted\n' >&2
  exit 1
fi

latest="traffic-20260803T033000Z.dump"
DATABASE_BACKUP_DIR="$TEST_ROOT/limited-backups" \
OFFSITE_BACKUP_RECEIPT_FILE="$TEST_ROOT/receipts/offsite-last-success" \
  "$ROOT_DIR/scripts/backups/record-offsite-backup.sh" \
  "$latest" \
  aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa >/dev/null

grep -q "backup_file=$latest" "$TEST_ROOT/receipts/offsite-last-success"
grep -q '^sha256=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa$' \
  "$TEST_ROOT/receipts/offsite-last-success"

if DATABASE_BACKUP_DIR="$TEST_ROOT/backups" \
  OFFSITE_BACKUP_RECEIPT_FILE="$TEST_ROOT/receipts/invalid" \
  "$ROOT_DIR/scripts/backups/record-offsite-backup.sh" '../invalid.dump' 'bad' >/dev/null 2>&1; then
  printf 'invalid receipt input was accepted\n' >&2
  exit 1
fi

printf 'database backup tests passed\n'
