# API Reference

## Base URLs (local default)

- `api-service`: `http://localhost:8080`
- `routes-service`: `http://localhost:8081`
- `ingest-service`: `http://localhost:8082` (internal poller, no public domain API currently)

## routes-service

### GET `/routes/corridors`

Returns configured corridor definitions.

Example request:

```bash
curl "http://localhost:8081/routes/corridors"
```

Example response:

```json
[
  {
    "name": "I25",
    "bbox": "40.627367,-105.031128,39.700390,-104.970703"
  },
  {
    "name": "I70",
    "bbox": "39.797997,-106.437378,39.492291,-104.963837"
  }
]
```

Status codes:
- `200 OK`

## api-service

### GET `/api/traffic/latest?corridor={name}`

Returns the newest persisted traffic sample for the given corridor.

Query params:
- `corridor` (required): corridor key, for example `I25`.

Example request:

```bash
curl "http://localhost:8080/api/traffic/latest?corridor=I25"
```

Example response:

```json
{
  "id": 412,
  "corridor": "I25",
  "avgCurrentSpeed": 48.2,
  "avgFreeflowSpeed": 63.0,
  "minCurrentSpeed": 27.0,
  "confidence": 0.91,
  "incidentsJson": "{\"incidents\":[{\"properties\":{\"roadNumbers\":[\"I25\"],\"iconCategory\":1,\"delay\":240}}]}",
  "polledAt": "2026-04-03T14:26:50.051247Z"
}
```

Status codes:
- `200 OK` when data exists.
- `400 Bad Request` when `corridor` is missing/blank.
- `404 Not Found` when corridor has no data yet.

### GET `/api/traffic/health`

Simple service health endpoint.

Example request:

```bash
curl "http://localhost:8080/api/traffic/health"
```

Example response:

```text
ok
```

Status codes:
- `200 OK`

## Actuator endpoints

Both `routes-service`, `ingest-service`, and `api-service` include Spring Boot Actuator dependency. Exposed endpoints depend on runtime configuration.

## Error handling conventions

- Validation failures use HTTP status codes (`400`/`404`) from controller logic.
- Ingestion-related transient failures are logged and skipped without crashing poll cycles.

## Planned API expansion

Planned endpoints are tracked in [docs/ROADMAP.md](ROADMAP.md), including:
- historical windows by corridor,
- comparison across corridors,
- incident-focused query APIs.
