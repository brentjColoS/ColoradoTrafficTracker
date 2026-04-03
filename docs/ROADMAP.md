# Roadmap

## Goal

Evolve Colorado Traffic Tracker from MVP backend into a robust traffic intelligence platform.

## Current stage

- MVP complete for corridor ingest + latest snapshot read API.

## Milestone 1: API maturity

Target outcomes:
- add historical endpoint (`/api/traffic/history?corridor=...&window=...`),
- add corridor list endpoint in api-service,
- add response DTOs to decouple entity persistence from API contracts.

Success criteria:
- clients can retrieve latest + recent trend slices without DB access.

## Milestone 2: Data governance

Target outcomes:
- introduce DB migrations (Flyway/Liquibase),
- define retention policy and archival strategy,
- normalize incidents into dedicated relational tables.

Success criteria:
- schema changes are versioned and reproducible.

## Milestone 3: Observability

Target outcomes:
- structured logging with correlation IDs,
- metrics dashboards (poll cycle success/failure, latency, ingest volume),
- alerting for ingestion gaps and quota pressure.

Success criteria:
- operational health can be assessed without code-level debugging.

## Milestone 4: Productization

Target outcomes:
- authn/authz for API endpoints,
- usage throttling and caching,
- deploy profile for cloud runtime.

Success criteria:
- externally consumable service posture with baseline security controls.

## Stretch goals

- anomaly detection across corridors,
- congestion forecasting model integration,
- frontend dashboard for live and historical visualization.
