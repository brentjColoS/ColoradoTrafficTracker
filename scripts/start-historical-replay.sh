#!/usr/bin/env bash
set -euo pipefail

root_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
docker_bin="${DOCKER_BIN:-docker}"
project_name="coloradotraffictracker"
replay_database="${REPLAY_POSTGRES_DB:-${POSTGRES_DB:-traffic}}"
[[ "$replay_database" =~ ^[A-Za-z0-9_]+$ ]] || {
  printf 'REPLAY_POSTGRES_DB must contain only letters, numbers, and underscores.\n' >&2
  exit 1
}
if [[ -n "${SSH_CONNECTION:-}" || -n "${SSH_CLIENT:-}" || "$root_dir" == /opt/* ]]; then
  printf 'Historical replay is local-only; server execution is refused.\n' >&2
  exit 1
fi
endpoint="${DOCKER_HOST:-$("$docker_bin" context inspect --format '{{.Endpoints.docker.Host}}')}"
if [[ "$endpoint" != unix://* ]]; then
  printf 'Historical replay requires a local Unix Docker endpoint.\n' >&2
  exit 1
fi
if ! database_project="$("$docker_bin" inspect --format '{{index .Config.Labels "com.docker.compose.project"}}' traffic-db 2>/dev/null)" \
    || [[ "$database_project" != "$project_name" ]]; then
  printf 'Historical replay requires the existing local coloradotraffictracker database; no container changed.\n' >&2
  exit 1
fi

compose_override="$(mktemp "${TMPDIR:-/tmp}/ctt-replay-compose.XXXXXX.yml")"
cleanup() { rm -f "$compose_override"; }
trap cleanup EXIT

printf '%s\n' \
  'services:' \
  '  api-service:' \
  '    environment:' \
  '      API_RATE_LIMIT_ENABLED: "false"' \
  '      SPRING_FLYWAY_ENABLED: "false"' \
  '      SPRING_DATASOURCE_HIKARI_READ_ONLY: "true"' \
  "      SPRING_DATASOURCE_URL: jdbc:postgresql://db:5432/$replay_database" \
  > "$compose_override"

compose() {
  HOST_BIND_ADDRESS=127.0.0.1 "$docker_bin" compose --project-name "$project_name" \
    --project-directory "$root_dir" -f "$root_dir/docker-compose.yml" -f "$compose_override" "$@"
}
compose config --quiet
compose build api-service
# Stop only this verified local project's poller before replacing its API.
compose stop ingest-service routes-service
compose up --no-build --no-deps -d api-service

printf '\nHistorical replay: http://localhost:8080/dashboard/?replay=1\n'
printf 'Default loop: Sep 10, 2026, 2:30–7:30 PM Denver time at 30x.\n'
printf 'The weekly baseline uses three months of retained hourly rollups.\n'
printf 'Existing local database: %s. Flyway off; API connection read-only.\n' "$replay_database"
printf 'Local ingest and routes services stopped; no provider calls.\n'
