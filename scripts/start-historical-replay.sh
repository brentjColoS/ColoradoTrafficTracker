#!/usr/bin/env bash
set -euo pipefail

# A replay must never inherit a previously running provider poller.
docker compose stop ingest-service routes-service
docker compose up --build -d db api-service

printf '\nHistorical live replay is ready at:\n'
printf '  http://localhost:8080/dashboard/?replay=1\n\n'
printf 'The default loop covers May 29, 2026, 2:00–7:00 PM Denver time at 30x.\n'
printf 'One real minute advances 30 historical minutes; 7D charts use retained hourly rollups.\n'
printf 'ingest-service and routes-service are stopped; no provider calls are made.\n'
