# Operations Runbook

## Operational objective

Keep ingestion healthy, maintain API responsiveness, and avoid external quota exhaustion.

## Service inventory

- `routes-service` (`:8081`): corridor metadata provider.
- `ingest-service` (`:8082`): scheduled polling and persistence.
- `api-service` (`:8080`): read/query API for latest corridor sample.
- `db` (`:5432`): persistent storage.

## Standard startup

```bash
docker compose up --build -d
```

Check status:

```bash
docker compose ps
```

## Health checks

Corridor source:

```bash
curl "http://localhost:8081/routes/corridors"
```

API health:

```bash
curl "http://localhost:8080/api/traffic/health"
```

Latest data:

```bash
curl "http://localhost:8080/api/traffic/latest?corridor=I25"
```

## Log inspection

```bash
docker compose logs ingest-service --tail=200
docker compose logs api-service --tail=200
docker compose logs routes-service --tail=200
```

Watch for:
- missing `TOMTOM_API_KEY`
- repeated upstream timeout/retry patterns
- zero-corridor responses from routes service
- database connectivity errors

## Ingestion mode operations

### Point mode

Set:

```env
TRAFFIC_MODE=point
```

Characteristics:
- lower computational complexity,
- sample-point based traffic averages.

### Tile mode

Set:

```env
TRAFFIC_MODE=tile
TRAFFIC_TILE_ZOOM=10
TRAFFIC_TILE_CONCURRENCY=4
TRAFFIC_TILE_ROUTE_BUFFER_METERS=500
```

Characteristics:
- richer route coverage,
- adaptive zoom and quota-guard behavior.

## Common incidents and response

### Incident: No rows in `traffic_sample`

Checks:
- Verify `TOMTOM_API_KEY` is set and valid.
- Verify `routes-service` is reachable from ingest service.
- Inspect ingest logs for API call failures.

### Incident: `latest` endpoint returns `404`

Checks:
- Confirm requested corridor name matches configured corridor keys (`I25`, `I70`, etc.).
- Confirm ingest has completed at least one successful poll cycle.

### Incident: Excessive upstream call volume

Actions:
- switch to lower tile zoom,
- increase `traffic.pollSeconds`,
- use point mode temporarily.

## Data operations

Inspect samples directly:

```bash
docker exec -it traffic-db psql -U traffic -d traffic -c "select corridor, polled_at, avg_current_speed from traffic_sample order by polled_at desc limit 20;"
```

## Backup and restore (local/dev)

Backup:

```bash
docker exec -t traffic-db pg_dump -U traffic traffic > backup.sql
```

Restore:

```bash
cat backup.sql | docker exec -i traffic-db psql -U traffic -d traffic
```

## Deployment checklist

Before promoting any release:

- verify CI is green,
- verify `docker compose up --build` works cleanly,
- verify `latest` endpoint returns data for at least one corridor,
- verify no secrets are committed to git,
- update `CHANGELOG.md`.
