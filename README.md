# Colorado Traffic Tracker

[![CI](https://github.com/brentjColoS/ColoradoTrafficTracker/actions/workflows/ci.yml/badge.svg)](https://github.com/brentjColoS/ColoradoTrafficTracker/actions/workflows/ci.yml)
[![Java](https://img.shields.io/badge/Java-21-007396?logo=openjdk&logoColor=white)](#tech-stack)
[![Spring Boot](https://img.shields.io/badge/Spring%20Boot-3.5.x-6DB33F?logo=springboot&logoColor=white)](#tech-stack)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-4169E1?logo=postgresql&logoColor=white)](#tech-stack)

Colorado Traffic Tracker is a multi-service, production-style backend system that ingests live traffic telemetry, stores normalized snapshots, and exposes query APIs for corridor-level and speed-zone traffic health.

This repository is intentionally structured as a high-standard engineering project both to demonstrate my own standards as well as push myself to learn higher level enterprise styling: clear service boundaries, external API integration, operational docs, CI automation, and contributor workflows.

Public dashboard: [https://coloradotraffictracker.net/dashboard/](https://coloradotraffictracker.net/dashboard/)

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
| - scheduled polling (point mode available, tile mode default on main)   |
| - calls TomTom Traffic + Routing APIs                                   |
| - computes corridor summaries, incidents, speed-zone summaries, and map-friendly metadata |
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

Deep-dive docs: [Architecture](https://github.com/brentjColoS/ColoradoTrafficTracker/wiki/Architecture), [API Reference](https://github.com/brentjColoS/ColoradoTrafficTracker/wiki/API-Reference), [Testing Strategy](https://github.com/brentjColoS/ColoradoTrafficTracker/wiki/Testing-Strategy), [Operations Runbook](https://github.com/brentjColoS/ColoradoTrafficTracker/wiki/Operations-Runbook), plus the repo-local [road sign display notes](docs/road-sign-display.md).

## Key features

- **Two ingestion strategies**: `point` mode and `tile` mode for different fidelity and quota profiles, with `tile` as the default local/runtime path on `main`.
- **Current local runtime standard**: tile-mode collection at `z11`, `60s` polling, and a `45k/day` tile budget cap, which lands around `43.2k/day` for the two tracked corridors.
- **Resilient external calls**: timeout handling, selective retries for transient failures, and graceful degradation.
- **Corridor-focused filtering**: incident filtering by corridor identity and route proximity.
- **Data governance baseline**: Flyway migrations, normalized incident rows, and retention/archival cleanup policy.
- **Analysis-ready storage**: corridor reference data, archive-inclusive history views, richer speed statistics, and incident references built around corridor + direction + nearest mile marker.
- **Speed-zone history foundation**: persisted posted-speed corridor zones, zone-history API responses, and localized slowdown notes that make smooth corridor averages easier to interpret.
- **Observability baseline**: correlation-aware logs, poll/ingest metrics, and health indicators for ingest gap + tile quota pressure.
- **Productization baseline**: API key auth, per-minute request throttling, response caching, and cloud profile support.
- **Testing hardening baseline**: baseline unit/regression coverage, targeted Spring integration tests, mutation testing profile, and CI quality gates.
- **Forecasting baseline**: corridor-level short-horizon speed forecasts with confidence bands for planning and dashboarding.
- **Dashboard UX baseline**: browser-accessible corridor dashboard for live snapshot, trend, stagnation assessment, anomaly summary, forecast view, speed-zone rotation, and cross-browser-stable corridor sign art.
- **Public hosted deployment**: single-host Hetzner VPS deployment behind Caddy/HTTPS at `coloradotraffictracker.net`, with the public dashboard exposed while protected API routes still require an API key.
- **Map and analytics surface**: GeoJSON corridor and incident responses plus corridor rollups, trend buckets, and incident hotspot summaries.
- **Mile-marker quality surface**: configured corridor anchors, incident snap metadata, startup calibration, and coverage assessment for spotting weak location references.
- **Operational controls**: environment-driven configuration, Docker Compose deployment, and Actuator integration.
- **Local and VPS operations helpers**: browser-safe local HTTPS, health watchdog, recovery drill, overnight soak runner, and a single-host VPS/Caddy deployment path.
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
# API_SECURITY_KEYS is only needed for direct /api access
# DASHBOARD_PUBLIC_DATA_ENABLED defaults to true for local dashboard use
```

Compose now loads the ingest service key directly from `.env`, which helps avoid stale shell-exported `TOMTOM_API_KEY` values overriding your local runtime setup.
`TRAFFIC_POLL_SECONDS` can also be overridden from your env file now, which is useful when you want a slower overnight cadence than the normal local 60-second loop.
`TRAFFIC_STARTUP_VALIDATION_ENABLED` defaults to `true`, but the test profile disables it so local and CI tests do not make live TomTom authorization calls at startup.
Transient null-data cycles now put the provider guard into a recoverable state instead of requiring a manual restart. `TRAFFIC_OBS_PROVIDER_NULL_CYCLE_THRESHOLD` controls how many consecutive null cycles trigger recovery mode, and `TRAFFIC_OBS_PROVIDER_RECOVERY_PROBE_SECONDS` controls the lightweight TomTom reachability probe cadence while recovery is active. Recoverable guard states classify the likely cause as `NETWORK`, `PROVIDER_5XX`, `RATE_LIMIT`, `QUOTA_HARD_STOP`, `ROUTES_SERVICE`, or `EMPTY_PAYLOAD`; missing or rejected credentials remain hard halts.
`TRAFFIC_HTTP_CONNECT_TIMEOUT_SECONDS` and `TRAFFIC_HTTP_RESPONSE_TIMEOUT_SECONDS` bound outbound ingest HTTP calls so network loss fails fast enough for retries, guard classification, and recovery probing to take over.
Compose also binds service ports to `127.0.0.1` by default; set `HOST_BIND_ADDRESS=0.0.0.0` only when you intentionally want LAN exposure.

Windows PowerShell:

```powershell
Copy-Item .env.example .env
```

### 3. Start the platform

```bash
docker compose up --build
```

Compose healthchecks gate app startup on a healthy database and route catalog service. The app images expose Spring Boot liveness probes, so transient TomTom outages and recoverable ingest degradation do not cause container churn.

Services:
- `api-service`: http://localhost:8080
- `routes-service`: http://localhost:8081
- `ingest-service`: http://localhost:8082
- Postgres: `localhost:${PGHOST_PORT:-5432}`

The default ingest profile uses `tile` mode at zoom `11` with quota guardrails tuned for about `43.2k` TomTom tile requests per day under a `45k/day` cap. Point sampling remains available for controlled runs with `TRAFFIC_MODE=point`.

### 3a. Cloud VPS deployment

For an online deployment without using a personal computer, use a small VPS with
Docker Compose and Caddy:

- [Cloud VPS Deployment](docs/cloud-vps-deployment.md)
- `.env.cloud.example`
- `deploy/caddy/Caddyfile.example`
- `deploy/systemd/colorado-traffic-tracker.service`

The current public portfolio deployment runs at:

```text
https://coloradotraffictracker.net/dashboard/
```

I got there by keeping the normal Compose architecture intact, moving it onto a
single Hetzner VPS, pointing the GoDaddy DNS `A` record at the server IPv4,
letting Caddy handle HTTPS, and exposing only the dashboard/proxy surface to the
public internet. The app/database containers remain bound behind the server
proxy instead of being opened directly.

### 3b. Browser-safe local HTTPS mode

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
curl -H "X-API-Key: ${API_SECURITY_KEYS:-dev-local-key}" "http://localhost:8080/api/traffic/zones/history?corridor=I25&windowMinutes=120&limit=240"
curl -H "X-API-Key: ${API_SECURITY_KEYS:-dev-local-key}" "http://localhost:8080/api/traffic/summary?corridor=I25&preferUsable=true"
curl -H "X-API-Key: ${API_SECURITY_KEYS:-dev-local-key}" "http://localhost:8080/api/traffic/map/corridors"
curl -H "X-API-Key: ${API_SECURITY_KEYS:-dev-local-key}" "http://localhost:8080/api/traffic/analytics/corridors?windowHours=168"
curl -H "X-API-Key: ${API_SECURITY_KEYS:-dev-local-key}" "http://localhost:8080/api/traffic/analytics/mile-marker-coverage?windowHours=168"
curl -H "X-API-Key: ${API_SECURITY_KEYS:-dev-local-key}" "http://localhost:8080/api/system/provider-status"
curl "http://localhost:8080/dashboard-api/traffic/corridors"
curl "http://localhost:8080/dashboard-api/traffic/latest?corridor=I25"
curl "http://localhost:8080/dashboard-api/system/provider-status"
curl "http://localhost:8082/actuator/health"
# open http://localhost:8080/dashboard/ in your browser
# or in browser-safe local HTTPS mode:
# open https://localhost/dashboard/
```

If `latest` returns `404`, wait one poll interval and retry. That usually means ingest has not saved the first sample yet.
If `latest` returns a sample with `null` speed fields, check `http://localhost:8082/actuator/health` before changing ingest settings. A fresh but `DEGRADED` provider guard status usually means ingest is recovering from a transient provider or network data gap; it should resume automatically after TomTom returns usable corridor speeds. A `HALTED` provider guard status still means a non-recoverable issue such as missing or rejected credentials needs operator action.
`/api/traffic/anomalies` and `/api/traffic/forecast` intentionally return `200` responses with a `note` field until enough history exists to compute a baseline or forecast.

### 4a. Optional local watchdog

Docker's restart policy handles crashed processes, but Docker Compose does not restart containers just because a healthcheck becomes unhealthy. For long local runs, start the watchdog after the stack is up:

```bash
./scripts/compose-health-watchdog.sh start .env
./scripts/compose-health-watchdog.sh status
./scripts/compose-health-watchdog.sh stop
```

The watchdog monitors `COMPOSE_HEALTH_WATCHDOG_SERVICES` and restarts a service after `COMPOSE_HEALTH_WATCHDOG_FAILURES` consecutive unhealthy checks, with `COMPOSE_HEALTH_WATCHDOG_COOLDOWN_SECONDS` between restarts. Leave `COMPOSE_HEALTH_WATCHDOG_MAX_CHECKS=0` for continuous monitoring, or set a positive value for bounded drills/tests.

After a laptop sleep, Wi-Fi interruption, or Docker hiccup, use the local recovery drill to avoid guessing at restart commands:

```bash
./scripts/local-recovery-drill.sh status .env
./scripts/local-recovery-drill.sh repair .env
./scripts/local-recovery-drill.sh snapshot .env
```

Snapshots are written under `.local/recovery-drills/` with Compose status, recent logs, health payloads, and provider guard state.

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

## Overnight soak run

Use the tracked overnight template when you want a lower-risk long-running validation instead of the default local cadence:

```bash
cp overnight-test.env.example overnight-test.env
# edit TOMTOM_API_KEY and any overnight-specific knobs
./scripts/overnight-test.sh start overnight-test.env
```

The helper script starts the Compose stack in detached mode, captures `docker compose logs`, and writes periodic health/data snapshots under `.local/overnight-tests/<timestamp>/`.
Monitoring now waits for the API and ingest actuator health endpoints before taking the first snapshot, which keeps cold-start noise out of otherwise healthy overnight runs.
For unattended runs, pair it with `./scripts/compose-health-watchdog.sh start overnight-test.env` so repeatedly unhealthy app containers get restarted while the snapshot monitor keeps collecting evidence.

Useful follow-up commands:

```bash
./scripts/overnight-test.sh status
./scripts/overnight-test.sh report
./scripts/overnight-test.sh stop --down
```

The default overnight template slows ingest to a 120-second poll interval, trims tile concurrency, waits up to 5 minutes for readiness, and probes `I25` every 5 minutes so you have a compact artifact trail to inspect the next morning.

## API preview

- `GET /routes/corridors`
- `GET /api/traffic/latest?corridor={name}` (`X-API-Key` required)
- `GET /api/traffic/history?corridor={name}&windowMinutes=180&limit=120` (`X-API-Key` required)
- `GET /api/traffic/zones/history?corridor={name}&windowMinutes=180&limit=240` (`X-API-Key` required)
- `GET /api/traffic/summary?corridor={name}&windowHours=168&recentIncidentWindowMinutes=720&preferUsable=true` (`X-API-Key` required)
- `GET /api/traffic/corridors` (`X-API-Key` required)
- `GET /api/traffic/anomalies?corridor={name}&windowMinutes=180&baselineMinutes=1440&zThreshold=2.0` (`X-API-Key` required)
- `GET /api/traffic/forecast?corridor={name}&horizonMinutes=60&windowMinutes=720&stepMinutes=15` (`X-API-Key` required)
- `GET /api/traffic/map/corridors` (`X-API-Key` required)
- `GET /api/traffic/map/incidents?corridor={name?}&windowMinutes=180&limit=250` (`X-API-Key` required)
- `GET /api/traffic/analytics/corridors?windowHours=168` (`X-API-Key` required)
- `GET /api/traffic/analytics/trends?corridor={name}&windowHours=168&limit=168` (`X-API-Key` required)
- `GET /api/traffic/analytics/hotspots?corridor={name?}&windowHours=168&limit=20` (`X-API-Key` required)
- `GET /api/traffic/analytics/mile-marker-coverage?windowHours=168` (`X-API-Key` required)
- `GET /api/system/provider-status` (`X-API-Key` required)
- `GET /api/traffic/health`
- `GET /dashboard-api/traffic/**` (public first-party dashboard read surface when `DASHBOARD_PUBLIC_DATA_ENABLED=true`, which is the default local Compose setting)
- `GET /dashboard-api/system/provider-status` (public provider guard snapshot when dashboard public data is enabled)
- `GET /dashboard/` (public UI over your locally ingested data; no browser-entered API key required)
- `GET /actuator/health` (ingest-service)

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

Current phase: **Publicly hosted analysis-ready traffic platform complete (ingest, governance, archival history, map surface, analytics views, mile-marker quality checks, observability, productization, anomaly detection, forecasting, dashboard, speed-zone history, local/VPS operations helpers, and a live Hetzner/Caddy deployment).**

See [Roadmap](https://github.com/brentjColoS/ColoradoTrafficTracker/wiki/Roadmap) for completed milestones and current backlog.

## Contributing

Contributions are welcome. Start with [CONTRIBUTING.md](CONTRIBUTING.md), then open an issue or pull request.

## License

This project is licensed under the MIT License. See [LICENSE](LICENSE).
