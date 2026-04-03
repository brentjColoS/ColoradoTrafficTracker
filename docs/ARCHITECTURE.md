# Architecture

## System overview

Colorado Traffic Tracker is a multi-module Java monorepo that models a production-like traffic data pipeline:

1. `routes-service` defines corridor boundaries.
2. `ingest-service` polls external traffic data on a schedule.
3. `api-service` exposes stored snapshots through a simple query API.
4. PostgreSQL/TimescaleDB stores normalized `traffic_sample` records.

The system is designed around bounded responsibilities per service and environment-driven configuration.

## Service boundaries

### routes-service

Responsibility:
- Source of truth for configured corridors.

Key behavior:
- Serves static corridor list from config (`routes.corridors`).
- Endpoint: `GET /routes/corridors`.

Why it exists:
- Decouples route definitions from ingestion logic.
- Enables future dynamic route management without touching poller code.

### ingest-service

Responsibility:
- Core ingestion and transformation engine.

Key behavior:
- Scheduled poll (`traffic.pollSeconds`).
- Pulls corridor list from `routes-service`.
- Calls TomTom traffic/routing APIs.
- Computes aggregate speed metrics and corridor-filtered incidents.
- Persists snapshot rows to `traffic_sample`.

Ingestion modes:
- `point`: route-based sampled points plus incidents endpoint.
- `tile`: vector tile flow/incidents extraction with quota-aware control.

Resilience patterns:
- Per-call timeout and retry with backoff on transient faults (timeouts/5xx).
- Graceful fallback on upstream errors.
- Route geometry caching to reduce repeated route recomputation.

### api-service

Responsibility:
- Consumer-facing read API.

Key behavior:
- Reads latest sample by corridor from `traffic_sample`.
- Endpoint: `GET /api/traffic/latest?corridor={name}`.

Why it exists:
- Separates read/query concerns from ingestion concerns.
- Keeps client contract stable while ingestion evolves.

## Data model

Primary table: `traffic_sample`

Fields:
- `id` (generated)
- `corridor`
- `avg_current_speed`
- `avg_freeflow_speed`
- `min_current_speed`
- `confidence`
- `incidents_json` (JSON payload as text)
- `polled_at` (UTC)

This schema captures point-in-time corridor snapshots suitable for downstream trend analysis.

## Runtime topology

```text
TomTom APIs ---> ingest-service ---> PostgreSQL/TimescaleDB ---> api-service clients
                   ^
                   |
             routes-service
```

## Configuration model

Configuration is primarily environment variable driven:

- `TOMTOM_API_KEY`
- `TRAFFIC_MODE` (`point` or `tile`)
- `TRAFFIC_TILE_ZOOM`
- `TRAFFIC_TILE_CONCURRENCY`
- `TRAFFIC_TILE_ROUTE_BUFFER_METERS`
- `SPRING_DATASOURCE_*`
- `ROUTES_BASE_URL`

Default local values are documented in `.env.example`.

## Deployment model

Default deployment path:
- `docker-compose.yml` launches db + three services with explicit ports.

Service ports:
- `api-service`: `8080`
- `routes-service`: `8081`
- `ingest-service`: `8082`
- DB: `5432` (configurable via `PGHOST_PORT`)

## Scalability notes

Current design favors clarity and correctness over horizontal scale. Natural scale-up paths:

- Add message queue between ingestion and storage for backpressure handling.
- Partition ingestion by corridor group.
- Move from JSON text incidents to normalized incident tables for analytical queries.
- Add caching layer for frequent read endpoints.

## Tradeoffs and assumptions

- External data quality and API quotas are provider-constrained.
- Ingestion stores snapshots, not raw full-fidelity event streams.
- Initial API favors minimal read interface for fast iteration.
- Security model currently assumes trusted network deployment for internal services.

## Future architecture directions

- Add dedicated analytics service for trend windows and anomaly detection.
- Add OpenTelemetry traces and centralized metrics dashboards.
- Add authentication/authorization for public API exposure.
- Add migration tooling (Flyway/Liquibase) for schema evolution governance.
