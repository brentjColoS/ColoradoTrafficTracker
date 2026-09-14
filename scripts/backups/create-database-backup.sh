#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ENV_FILE="${1:-${APP_ENV_FILE:-$ROOT_DIR/.env.cloud}}"
BACKUP_DIR="${DATABASE_BACKUP_DIR:-/var/backups/colorado-traffic-tracker/database}"
BACKUP_RETENTION_COUNT="${DATABASE_BACKUP_RETENTION_COUNT:-7}"
DATABASE_CONTAINER="${DATABASE_CONTAINER:-traffic-db}"
BACKUP_READ_GROUP="${DATABASE_BACKUP_READ_GROUP:-}"
DOCKER_BIN="${DOCKER_BIN:-docker}"
DATE_BIN="${DATE_BIN:-date}"
SHA256_BIN="${SHA256_BIN:-sha256sum}"

log() {
  printf '[database-backup] %s\n' "$*"
}

fail() {
  log "failed: $*" >&2
  exit 1
}

[[ -f "$ENV_FILE" ]] || fail "environment file not found: $ENV_FILE"
[[ "$BACKUP_RETENTION_COUNT" =~ ^[1-9][0-9]*$ ]] \
  || fail "DATABASE_BACKUP_RETENTION_COUNT must be a positive whole number"

set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

POSTGRES_USER="${POSTGRES_USER:-traffic}"
POSTGRES_DB="${POSTGRES_DB:-traffic}"

mkdir -p "$BACKUP_DIR"
chmod 0750 "$BACKUP_DIR"
if [[ -n "$BACKUP_READ_GROUP" ]]; then
  chgrp "$BACKUP_READ_GROUP" "$BACKUP_DIR"
fi

timestamp="$("$DATE_BIN" -u +%Y%m%dT%H%M%SZ)"
filename="traffic-${timestamp}.dump"
destination="$BACKUP_DIR/$filename"
partial="$(mktemp "$BACKUP_DIR/.traffic-${timestamp}.XXXXXX")"
manifest_partial="$(mktemp "$BACKUP_DIR/.traffic-${timestamp}.sha256.XXXXXX")"

cleanup() {
  rm -f "$partial" "$manifest_partial"
}
trap cleanup EXIT

log "creating $filename"
"$DOCKER_BIN" exec "$DATABASE_CONTAINER" pg_dump \
  --username "$POSTGRES_USER" \
  --dbname "$POSTGRES_DB" \
  --format custom \
  --compress 6 \
  --no-owner \
  --no-privileges > "$partial"

[[ -s "$partial" ]] || fail "pg_dump produced an empty file"
"$DOCKER_BIN" exec -i "$DATABASE_CONTAINER" pg_restore --list < "$partial" >/dev/null \
  || fail "pg_restore could not read the completed dump"

checksum="$("$SHA256_BIN" "$partial" | awk '{print $1}')"
[[ "$checksum" =~ ^[0-9a-f]{64}$ ]] || fail "could not calculate a SHA-256 checksum"

printf '%s  %s\n' "$checksum" "$filename" > "$manifest_partial"
chmod 0640 "$partial" "$manifest_partial"
if [[ -n "$BACKUP_READ_GROUP" ]]; then
  chgrp "$BACKUP_READ_GROUP" "$partial" "$manifest_partial"
fi

mv "$partial" "$destination"
mv "$manifest_partial" "$destination.sha256"

retained_backups=()
while IFS= read -r retained_backup; do
  retained_backups+=("$retained_backup")
done < <(
  find "$BACKUP_DIR" -maxdepth 1 -type f -name 'traffic-*.dump' -print | sort -r
)

for ((index = BACKUP_RETENTION_COUNT; index < ${#retained_backups[@]}; index++)); do
  expired="${retained_backups[$index]}"
  rm -f "$expired" "$expired.sha256"
done

trap - EXIT
log "complete: $destination sha256=$checksum"
