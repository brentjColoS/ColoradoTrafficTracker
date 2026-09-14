#!/usr/bin/env bash

set -euo pipefail

BACKUP_DIR="${DATABASE_BACKUP_DIR:-/var/backups/colorado-traffic-tracker/database}"
RECEIPT_FILE="${OFFSITE_BACKUP_RECEIPT_FILE:-/var/lib/colorado-traffic-tracker/backups/offsite-last-success}"

fail() {
  printf '[offsite-backup-receipt] failed: %s\n' "$*" >&2
  exit 1
}

filename="${1:-}"
checksum="${2:-}"

[[ "$filename" =~ ^traffic-[0-9]{8}T[0-9]{6}Z\.dump$ ]] \
  || fail "invalid backup filename"
[[ "$checksum" =~ ^[0-9a-fA-F]{64}$ ]] \
  || fail "invalid SHA-256 checksum"

manifest="$BACKUP_DIR/$filename.sha256"
[[ -f "$BACKUP_DIR/$filename" && -f "$manifest" ]] \
  || fail "backup or checksum manifest is missing"

expected="$(awk 'NR == 1 {print $1}' "$manifest")"
normalized_checksum="$(printf '%s' "$checksum" | tr '[:upper:]' '[:lower:]')"
normalized_expected="$(printf '%s' "$expected" | tr '[:upper:]' '[:lower:]')"
[[ "$normalized_checksum" == "$normalized_expected" ]] \
  || fail "checksum does not match the server manifest"

receipt_dir="$(dirname "$RECEIPT_FILE")"
mkdir -p "$receipt_dir"
partial="$(mktemp "$receipt_dir/.offsite-last-success.XXXXXX")"
trap 'rm -f "$partial"' EXIT

{
  printf 'completed_at=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  printf 'backup_file=%s\n' "$filename"
  printf 'sha256=%s\n' "$normalized_checksum"
} > "$partial"

chmod 0640 "$partial"
mv "$partial" "$RECEIPT_FILE"
trap - EXIT

printf '[offsite-backup-receipt] recorded: %s\n' "$filename"
