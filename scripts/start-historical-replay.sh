#!/usr/bin/env bash
set -euo pipefail

root_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
replay_database="${REPLAY_POSTGRES_DB:-${POSTGRES_DB:-traffic}}"
[[ "$replay_database" =~ ^[A-Za-z0-9_]+$ ]] || {
  printf 'REPLAY_POSTGRES_DB must contain only letters, numbers, and underscores.\n' >&2
  exit 1
}

compose_override="$(mktemp "${TMPDIR:-/tmp}/ctt-replay-compose.XXXXXX.yml")"
cleanup() {
  rm -f "$compose_override"
}
trap cleanup EXIT

printf '%s\n' \
  'services:' \
  '  api-service:' \
  '    environment:' \
  '      API_RATE_LIMIT_ENABLED: "false"' \
  "      SPRING_DATASOURCE_URL: jdbc:postgresql://db:5432/$replay_database" \
  > "$compose_override"

# A replay must never inherit a previously running provider poller.
docker compose --project-directory "$root_dir" -f "$root_dir/docker-compose.yml" \
  stop ingest-service routes-service
docker compose --project-directory "$root_dir" -f "$root_dir/docker-compose.yml" -f "$compose_override" \
  up --build -d db api-service

printf '\nHistorical live replay is ready at:\n'
printf '  http://localhost:8080/dashboard/?replay=1\n\n'
printf 'The default loop covers Sep 10, 2026, 2:30–7:30 PM Denver time at 30x.\n'
printf 'One real minute advances 30 historical minutes; the baseline uses three months of retained hourly rollups.\n'
printf 'Database: %s\n' "$replay_database"
printf 'ingest-service and routes-service are stopped; no provider calls are made.\n'
