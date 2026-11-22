![Colorado Traffic Tracker](https://raw.githubusercontent.com/brentjColoS/ColoradoTrafficTracker/main/docs/assets/ctt-wordmark.svg)

Retention changes where observations live without removing them from historical
queries. Sample references must survive that move, while incident events outlive
individual flow polls.

## Recorded data volume

The public dashboard's stored-observation counter reported **531,796 corridor
observations** at 6:46 PM MST on November 21, 2026: 265,898 for I-25 and 265,898
for I-70. The earliest retained observation dates to April 10, 2026 (UTC).
The count includes original corridor samples across the live and archive
tables; speed-zone rows, map cells and incident records are separate datasets.

The [measurement record](https://github.com/brentjColoS/ColoradoTrafficTracker/blob/main/docs/evidence/portfolio-measurements-2026-11-21.json)
preserves the returned counter, source URL and fetch time. The
[`StoredObservationRepository`](https://github.com/brentjColoS/ColoradoTrafficTracker/blob/main/api-service/src/main/java/com/example/api_service/StoredObservationRepository.java)
counts both tiers in one SQL statement, so an archive move cannot split the
counter across two database snapshots. The counter describes stored volume;
dataset-specific gaps and changes remain documented in the
[coverage notes](https://github.com/brentjColoS/ColoradoTrafficTracker/blob/main/docs/data-history-coverage.md).

## A stable reference across two storage tiers

`traffic_sample_all` combines the live and archive tables with `UNION ALL`.
This reduced identity projection shows the contract defined in
[V11](https://github.com/brentjColoS/ColoradoTrafficTracker/blob/main/api-service/src/main/resources/db/migration/V11__semantic_zone_state.sql):

```sql
select id as history_id, id as sample_ref_id,
       false as is_archived
from traffic_sample
union all
select -source_id as history_id, source_id as sample_ref_id,
       true as is_archived
from traffic_sample_archive;
```

The complete view also carries speeds, timestamps and source metadata. A sample
whose original ID is 42 has `sample_ref_id = 42` in either tier. Its `history_id`
changes from 42 to -42 after archival. Historical joins use the logical sample
reference when they need to survive that move.

## Transactional atomicity at the retention boundary

[`TrafficRetentionBatchWriter.archiveNext`](https://github.com/brentjColoS/ColoradoTrafficTracker/blob/main/ingest-service/src/main/java/com/example/ingest_service/TrafficRetentionBatchWriter.java)
runs three steps inside one transaction:

1. Copy older sample-linked incidents into their archive.
2. Copy the corresponding corridor samples, including provenance metadata.
3. Delete the live parent samples.

Each statement selects an oldest-first batch ordered by `(polled_at, id)` and
bounded by a row limit. Archive inserts skip source IDs already copied. Readers
do not see a committed intermediate state containing only one side of a
successful copy/delete transaction.

The scheduler commits one batch at a time. Repository defaults are 500 samples
per batch and up to 20 batches per run: the first setting bounds each transaction,
and the second bounds the work before yielding to a later scheduled run. A
dedicated retention scheduler keeps cleanup separate from provider polling.
Archived observations remain queryable after the move.

The [recorded workload](Testing-Strategy) exercised a fixed 600-sample backlog.
It verifies that case without establishing optimal batch sizes or throughput
under continuously growing archive work.

## Speed zones outlive their live parent

Originally, a speed-zone row referenced only `traffic_sample`. Moving the parent
out of that table could remove the detailed observation along with it.
Migration [V24](https://github.com/brentjColoS/ColoradoTrafficTracker/blob/main/api-service/src/main/resources/db/migration/V24__preserve_speed_zone_history.sql)
removes the live-only foreign key and keeps `sample_id` as a logical reference:

- While live, it joins `traffic_sample.id`.
- After archival, it joins `traffic_sample_archive.source_id`.

This permits durable detail across the tier split, at the cost of losing that
single-table foreign-key check. The indexed logical reference becomes part of
the writer and reader contract. Detail deleted before this change cannot be
reconstructed from a corridor average.

## Idempotency and incident identity

[`IncidentEventWriter`](https://github.com/brentjColoS/ColoradoTrafficTracker/blob/main/ingest-service/src/main/java/com/example/ingest_service/IncidentEventWriter.java)
upserts events by `(provider, provider_event_id)`. Idempotency is scoped to unique
keys: payload observations use `(event_id, payload_hash)`, and lifecycle
transitions use `(event_id, occurred_at, transition_type)`. Separate records
track corridor membership and preserve reactivation and rematch history.

Repeated payloads can refresh last-seen state without appending a duplicate
observation. A changed payload must still update current state even if its
observation was previously recorded; that case has a dedicated regression test.

A successful empty incident list can close missing events. A malformed snapshot
aborts publication. That distinction prevents invalid input from becoming a
false all-clear update. Current maps and timelines use these durable events;
new speed samples retain summary context without copying a full incident
payload on every flow poll. Older sample-linked incidents remain readable for
legacy history.

## Dataset resolution and provenance

| Dataset | Retained meaning |
| --- | --- |
| Corridor samples | Original aggregate observations across live and archive tables. |
| Speed zones | Detailed observations retained independently after V24; earlier deleted detail remains missing. |
| Local flow cells | Current snapshots are replaced; historical cells are aggregated by UTC hour. |
| Incident events | Provider identities and transitions, with a separate boundary for older reconstructed episodes. |

V28 also records optional collection profiles without inferring old precision.
Legacy profiles remain unknown. Hourly map data can be marked `mixed` when
different or unknown profiles meet; rolling back a collection setting does not
rewrite that provenance. The
[coverage notes](https://github.com/brentjColoS/ColoradoTrafficTracker/blob/main/docs/data-history-coverage.md)
record verified starts, the I-70 extent change and optional sign-history limits.

## Verification

[`TrafficRetentionBatchWriterTest`](https://github.com/brentjColoS/ColoradoTrafficTracker/blob/main/ingest-service/src/test/java/com/example/ingest_service/TrafficRetentionBatchWriterTest.java)
checks bounded, ordered SQL and the transaction declaration. That is a unit
check of the writer, not a database crash-recovery test.

[`StoredObservationDatabaseTest`](https://github.com/brentjColoS/ColoradoTrafficTracker/blob/main/api-service/src/test/java/com/example/api_service/StoredObservationDatabaseTest.java)
moves a fixture row between live and archive tables in PostgreSQL and verifies
that the total and earliest observation remain stable.

[`IncidentEventWriterTest`](https://github.com/brentjColoS/ColoradoTrafficTracker/blob/main/ingest-service/src/test/java/com/example/ingest_service/IncidentEventWriterTest.java)
covers stable identities, empty successful snapshots, malformed input,
reactivation and changed payloads. Backup restore checks provide a separate
form of recovery evidence, described in [Operations and reliability](Operations-Runbook).

[← Provider collection](Provider-Collection) · [Dashboard reads →](Dashboard-Reads)
