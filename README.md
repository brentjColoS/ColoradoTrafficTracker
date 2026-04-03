# Colorado Traffic Tracker

[![CI](https://github.com/brentjColoS/ColoradoTrafficTracker/actions/workflows/ci.yml/badge.svg)](https://github.com/brentjColoS/ColoradoTrafficTracker/actions/workflows/ci.yml)
[![Java](https://img.shields.io/badge/Java-21-007396?logo=openjdk&logoColor=white)](#tech-stack)
[![Spring Boot](https://img.shields.io/badge/Spring%20Boot-3.5.x-6DB33F?logo=springboot&logoColor=white)](#tech-stack)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-4169E1?logo=postgresql&logoColor=white)](#tech-stack)

Colorado Traffic Tracker is a multi-service, production-style backend system that ingests live traffic telemetry, stores normalized snapshots, and exposes query APIs for corridor-level traffic health.

This repository is intentionally structured as a portfolio-quality engineering project: clear service boundaries, external API integration, operational docs, CI automation, and contributor workflows.

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
| - scheduled polling (point mode or tile mode)                          |
| - calls TomTom Traffic + Routing APIs                                  |
| - computes corridor summaries and incidents                             |
| - writes snapshots into PostgreSQL / TimescaleDB                       |
+-----------------------------+-------------------------------------------+
                              |
                              v
                    +-------------------+
                    |   PostgreSQL DB   |
                    |   traffic_sample  |
                    +---------+---------+
                              |
                              v
                    +-------------------+
                    |    api-service    |
                    | read/query layer  |
                    +-------------------+
```

- `routes-service` serves corridor metadata.
- `ingest-service` owns polling and persistence.
- `api-service` exposes client-facing query endpoints.
- `common` holds shared module dependencies.

Deep-dive docs: [Architecture](docs/ARCHITECTURE.md), [API Reference](docs/API_REFERENCE.md), [Operations Runbook](docs/OPERATIONS_RUNBOOK.md).

## Key features

- **Two ingestion strategies**: `point` mode and `tile` mode for different fidelity and quota profiles.
- **Resilient external calls**: timeout handling, selective retries for transient failures, and graceful degradation.
- **Corridor-focused filtering**: incident filtering by corridor identity and route proximity.
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
├─ docs/                   # Architecture, API, setup, runbook, roadmap
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

### 4. Verify data flow

```bash
curl "http://localhost:8081/routes/corridors"
curl "http://localhost:8080/api/traffic/latest?corridor=I25"
```

If ingestion has run at least once, `latest` should return a traffic snapshot for the corridor.

## Local development

Build all modules:

```bash
./mvnw clean verify
```

Run individual services locally:

```bash
./mvnw -pl routes-service spring-boot:run
./mvnw -pl ingest-service spring-boot:run
./mvnw -pl api-service spring-boot:run
```

See full setup instructions: [Local Development Guide](docs/LOCAL_DEVELOPMENT.md).

## API preview

- `GET /routes/corridors`
- `GET /api/traffic/latest?corridor={name}`
- `GET /api/traffic/health`

Detailed request/response examples: [API Reference](docs/API_REFERENCE.md).

## Engineering quality signals

- Multi-module architecture with explicit service responsibilities
- Retries/timeouts/backoff on external calls
- Environment-driven config and containerized deployment
- CI workflow for build + tests
- Contributor guidance and issue/PR templates
- Security policy and roadmap/changelog artifacts

## Documentation index

- [Architecture](docs/ARCHITECTURE.md)
- [API Reference](docs/API_REFERENCE.md)
- [Local Development](docs/LOCAL_DEVELOPMENT.md)
- [Operations Runbook](docs/OPERATIONS_RUNBOOK.md)
- [Project Journey](docs/PROJECT_JOURNEY.md)
- [Roadmap](docs/ROADMAP.md)
- [Changelog](CHANGELOG.md)

## Project status

Current phase: **MVP backend platform with live polling and read API complete; observability and analytics layers in progress.**

See [Roadmap](docs/ROADMAP.md) for planned milestones.

## Contributing

Contributions are welcome. Start with [CONTRIBUTING.md](CONTRIBUTING.md), then open an issue or pull request.

## License

This project is licensed under the MIT License. See [LICENSE](LICENSE).
