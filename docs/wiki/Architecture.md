# Architecture (Wiki)

Canonical document: [../ARCHITECTURE.md](../ARCHITECTURE.md)

## Snapshot

- Monorepo, Maven multi-module.
- Polling pipeline from TomTom APIs to Postgres.
- Read API for latest sample by corridor.

## Runtime flow

1. `routes-service` returns corridor definitions.
2. `ingest-service` polls and computes snapshots.
3. Samples are persisted to `traffic_sample`.
4. `api-service` returns latest corridor data.

For detailed tradeoffs and future architecture directions, use the canonical architecture doc.
