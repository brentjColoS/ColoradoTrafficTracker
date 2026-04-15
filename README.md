# Colorado Traffic Tracker

[![CI](https://github.com/brentjColoS/ColoradoTrafficTracker/actions/workflows/ci.yml/badge.svg)](https://github.com/brentjColoS/ColoradoTrafficTracker/actions/workflows/ci.yml)
[![Java](https://img.shields.io/badge/Java-21-007396?logo=openjdk&logoColor=white)](#tech-stack)
[![Spring Boot](https://img.shields.io/badge/Spring%20Boot-3.5.x-6DB33F?logo=springboot&logoColor=white)](#tech-stack)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-4169E1?logo=postgresql&logoColor=white)](#tech-stack)

Colorado Traffic Tracker is a multi-service, production-style backend system that ingests live traffic telemetry, stores normalized snapshots, and exposes query APIs for corridor-level traffic health.

This repository is intentionally structured as a high-standard engineering project both to demonstrate my own standards as well as push myself to learn higher level enterprise styling: clear service boundaries, external API integration, operational docs, CI automation, and contributor workflows.

## Why this project exists

Colorado Front Range traffic continues to grow, and real-time visibility is fragmented across provider-specific dashboards. This system explores how to:

- ingest and normalize live traffic data from a third-party platform,
- model corridor-level traffic behavior over time,
- expose clean APIs for downstream dashboards and analytics,
- operate the stack as a containerized, repeatable deployment.

## Architecture at a glance

```text
                +-----------------------------+
                |        routes-service       |
                | static corridor definitions |
                +-------------+---------------+
                              |
                              v
+---------------------------- ingest-service -----------------------------+
| - scheduled polling (point mode or tile mode)                           |
| - calls TomTom Traffic + Routing APIs                                   |
| - computes corridor summaries, incidents, and map-friendly metadata     |
| - writes live + archival history into PostgreSQL / TimescaleDB          |
+-----------------------------+-------------------------------------------+
                              |
                              v
                    +-------------------+
                    | PostgreSQL /      |
                    | TimescaleDB       |
                    | corridor_ref      |
                    | traffic_* tables  |
                    | history views     |
                    +---------+---------+
                              |
                              v
                    +-------------------+
                    |    api-service    |
                    | read/query, map,  |
                    | analytics, UI     |
                    +-------------------+
```

- `routes-service` serves corridor metadata.
- `ingest-service` owns polling and persistence.
- `api-service` exposes client-facing query endpoints.
- `common` holds shared module dependencies.

Deep-dive docs: [Architecture](https://github.com/brentjColoS/ColoradoTrafficTracker/wiki/Architecture), [API Reference](https://github.com/brentjColoS/ColoradoTrafficTracker/wiki/API-Reference), [Testing Strategy](https://github.com/brentjColoS/ColoradoTrafficTracker/wiki/Testing-Strategy), [Operations Runbook](https://github.com/brentjColoS/ColoradoTrafficTracker/wiki/Operations-Runbook).

## Key features

- **Two ingestion strategies**: `point` mode and `tile` mode for different fidelity and quota profiles, with `tile` as the default local/runtime path.
- **Resilient external calls**: timeout handling, selective retries for transient failures, and graceful degradation.
- **Corridor-focused filtering**: incident filtering by corridor identity and route proximity.
- **Data governance baseline**: Flyway migrations, normalized incident rows, and retention/archival cleanup policy.
- **Analysis-ready storage**: corridor reference data, archive-inclusive history views, richer speed statistics, and incident references built around corridor + direction + nearest mile marker.
- **Observability baseline**: correlation-aware logs, poll/ingest metrics, and health indicators for ingest gap + tile quota pressure.
- **Productization baseline**: API key auth, per-minute request throttling, response caching, and cloud profile support.
- **Testing hardening baseline**: baseline unit/regression coverage, targeted Spring integration tests, mutation testing profile, and CI quality gates.
- **Forecasting baseline**: corridor-level short-horizon speed forecasts with confidence bands for planning and dashboarding.
- **Dashboard UX baseline**: browser-accessible corridor dashboard for live snapshot, trend, anomaly summary, and forecast view.
- **Map and analytics surface**: GeoJSON corridor and incident responses plus corridor rollups, trend buckets, and incident hotspot summaries.
- **Operational controls**: environment-driven configuration, Docker Compose deployment, and Actuator integration.
- **Portfolio documentation suite**: architecture docs, runbooks, roadmap, contribution templates, and CI.

## Tech stack

- Java 21
- Spring Boot 3.5.x
- Spring Data JPA
- Spring Web / WebFlux
- PostgreSQL / TimescaleDB (containerized)
- Maven multi-module build
- Docker + Docker Compose
- GitHub Actions CI

## Repository layout

```text
.
├─ api-service/            # Read/query API over stored traffic samples
├─ ingest-service/         # Scheduled data ingestion from external APIs
├─ routes-service/         # Corridor definitions served over HTTP
├─ common/                 # Shared module
├─ (GitHub Wiki)           # Canonical architecture/API/runbook/project documentation
└─ .github/                # CI workflows + issue/PR templates
```

## Quick start (Docker Compose)

### 1. Prerequisites

- Docker Desktop (or Docker Engine + Compose)
- Java 21 (for local Maven runs)
- A TomTom API key

### 2. Configure environment

```bash
cp .env.example .env
# then edit TOMTOM_API_KEY in .env
# and set API_SECURITY_KEYS for api-service access
```

Compose now loads the ingest service key directly from `.env`, which helps avoid stale shell-exported `TOMTOM_API_KEY` values overriding your local runtime setup.

Windows PowerShell:

```powershell
Copy-Item .env.example .env
```

### 3. Start the platform

```bash
docker compose up --build
```

Services:
- `api-service`: http://localhost:8080
- `routes-service`: http://localhost:8081
- `ingest-service`: http://localhost:8082
- Postgres: `localhost:${PGHOST_PORT:-5432}`

The default ingest profile uses `tile` mode at zoom `10` with quota guardrails tuned for roughly `35k-40k` TomTom tile requests per day. To force classic point sampling for a run, start Compose with `TRAFFIC_MODE=point`.

### 3a. Browser-safe local HTTPS mode

For browsers that auto-upgrade localhost traffic to HTTPS, bootstrap a trusted local certificate and start the optional proxy profile:

```bash
./scripts/setup-local-https.sh
docker compose --profile https up --build
```

Browser-safe local URLs:
- dashboard: `https://localhost/dashboard/`
- traffic API health: `https://localhost/api/traffic/health`
- routes-service: `https://localhost/routes/corridors`
- ingest health: `https://localhost/ingest/actuator/health`

### 4. Verify data flow

```bash
curl "http://localhost:8081/routes/corridors"
curl "http://localhost:8080/api/traffic/health"
curl -H "X-API-Key: ${API_SECURITY_KEYS:-dev-local-key}" "http://localhost:8080/api/traffic/latest?corridor=I25"
curl -H "X-API-Key: ${API_SECURITY_KEYS:-dev-local-key}" "http://localhost:8080/api/traffic/map/corridors"
curl -H "X-API-Key: ${API_SECURITY_KEYS:-dev-local-key}" "http://localhost:8080/api/traffic/analytics/corridors?windowHours=168"
curl "http://localhost:8082/actuator/health"
curl "http://localhost:8082/actuator/metrics"
# open http://localhost:8080/dashboard/ in your browser
# or in browser-safe local HTTPS mode:
# open https://localhost/dashboard/
```

If `latest` returns `404`, wait one poll interval and retry. That usually means ingest has not saved the first sample yet.
If `latest` returns a sample with `null` speed fields, check `http://localhost:8082/actuator/health` before changing ingest settings. A fresh but `DEGRADED` `ingestionGap` status usually means the TomTom key can reach the scheduler, but not the traffic endpoints needed for usable speed data.
`/api/traffic/anomalies` and `/api/traffic/forecast` intentionally return `200` responses with a `note` field until enough history exists to compute a baseline or forecast.

## Local development

Build all modules:

```bash
./mvnw clean verify
```

Windows PowerShell:

```powershell
.\mvnw.cmd clean verify
```

Run mutation tests:

```bash
./mvnw -Pmutation -pl routes-service,ingest-service,api-service -am test
```

Windows PowerShell:

```powershell
.\mvnw.cmd -Pmutation -pl routes-service,ingest-service,api-service -am test
```

Run individual services locally:

```bash
./mvnw -pl routes-service spring-boot:run
./mvnw -pl ingest-service spring-boot:run
./mvnw -pl api-service spring-boot:run
```

Windows PowerShell:

```powershell
.\mvnw.cmd -pl routes-service spring-boot:run
.\mvnw.cmd -pl ingest-service spring-boot:run
.\mvnw.cmd -pl api-service spring-boot:run
```

See full setup instructions: [Local Development Guide](https://github.com/brentjColoS/ColoradoTrafficTracker/wiki/Local-Development).

## API preview

- `GET /routes/corridors`
- `GET /api/traffic/latest?corridor={name}` (`X-API-Key` required)
- `GET /api/traffic/history?corridor={name}&windowMinutes=180&limit=120` (`X-API-Key` required)
- `GET /api/traffic/corridors` (`X-API-Key` required)
- `GET /api/traffic/anomalies?corridor={name}&windowMinutes=180&baselineMinutes=1440&zThreshold=2.0` (`X-API-Key` required)
- `GET /api/traffic/forecast?corridor={name}&horizonMinutes=60&windowMinutes=720&stepMinutes=15` (`X-API-Key` required)
- `GET /api/traffic/map/corridors` (`X-API-Key` required)
- `GET /api/traffic/map/incidents?corridor={name?}&windowMinutes=180&limit=250` (`X-API-Key` required)
- `GET /api/traffic/analytics/corridors?windowHours=168` (`X-API-Key` required)
- `GET /api/traffic/analytics/trends?corridor={name}&windowHours=168&limit=168` (`X-API-Key` required)
- `GET /api/traffic/analytics/hotspots?corridor={name?}&windowHours=168&limit=20` (`X-API-Key` required)
- `GET /api/traffic/health`
- `GET /dashboard/` (public UI; enter API key in-page)
- `GET /actuator/health` (ingest-service)
- `GET /actuator/metrics` (ingest-service)

Use `SPRING_PROFILES_ACTIVE=cloud` to run the cloud-tuned profile.

Detailed request/response examples: [API Reference](https://github.com/brentjColoS/ColoradoTrafficTracker/wiki/API-Reference).

## Engineering quality signals

- Multi-module architecture with explicit service responsibilities
- Retries/timeouts/backoff on external calls
- Environment-driven config and containerized deployment
- Archive-inclusive history views and richer statistical fields for analysis
- GeoJSON-oriented map endpoints and human-readable corridor references
- CI workflow with standard verification + mutation testing
- JaCoCo coverage quality gate in Maven `verify`
- PIT mutation thresholds per service module
- Contributor guidance and issue/PR templates
- Security policy and roadmap/changelog artifacts

## Documentation index

- [Wiki Home](https://github.com/brentjColoS/ColoradoTrafficTracker/wiki)
- [Architecture](https://github.com/brentjColoS/ColoradoTrafficTracker/wiki/Architecture)
- [API Reference](https://github.com/brentjColoS/ColoradoTrafficTracker/wiki/API-Reference)
- [Local Development](https://github.com/brentjColoS/ColoradoTrafficTracker/wiki/Local-Development)
- [Testing Strategy](https://github.com/brentjColoS/ColoradoTrafficTracker/wiki/Testing-Strategy)
- [Operations Runbook](https://github.com/brentjColoS/ColoradoTrafficTracker/wiki/Operations-Runbook)
- [Project Journey](https://github.com/brentjColoS/ColoradoTrafficTracker/wiki/Project-Journey)
- [Roadmap](https://github.com/brentjColoS/ColoradoTrafficTracker/wiki/Roadmap)
- [Changelog](CHANGELOG.md)

## Project status

Current phase: **Analysis-ready traffic platform complete (ingest, governance, archival history, map surface, analytics views, observability, productization, anomaly detection, forecasting, and dashboard).**

See [Roadmap](https://github.com/brentjColoS/ColoradoTrafficTracker/wiki/Roadmap) for planned milestones.

## Contributing

Contributions are welcome. Start with [CONTRIBUTING.md](CONTRIBUTING.md), then open an issue or pull request.

## License

This project is licensed under the MIT License. See [LICENSE](LICENSE).
