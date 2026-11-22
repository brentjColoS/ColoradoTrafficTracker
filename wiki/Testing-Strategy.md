![Colorado Traffic Tracker](https://raw.githubusercontent.com/brentjColoS/ColoradoTrafficTracker/main/docs/assets/ctt-wordmark.svg)

CTT tests request accounting, historical access and dashboard behavior at
several levels, from individual writers to the packaged application.

## Recorded local browser workload

On November 13, 2026, a local test ran ten browser sessions for 1,806 seconds
against application revision
[`c558137f`](https://github.com/brentjColoS/ColoradoTrafficTracker/commit/c558137fa547d24d85c70225039156d2b25fcd5b).
All 300 historical-window checks completed without recorded browser, HTTP,
freshness or latency-target failures. The API was limited to 1.5 CPU and
1,536 MiB, with a 12-connection pool; the fixture held 180 days of synthetic
corridor history.

| Browser-visible measurement | Samples | Result |
| --- | --- | --- |
| Useful opening: current values and chart summary ready | 10 openings | Maximum 1.497 seconds. |
| Selected-window chart painted | 300 selections | p95 2.049 seconds; maximum 3.540 seconds. |
| Selected-window summary cards complete | 300 selections | p95 2.864 seconds; maximum 9.800 seconds. |

During the run, the packaged sample writer and retention job each completed 30
cycles. All 600 archival canaries moved with matching content hashes and
archive-inclusive row continuity; the writer added 60 samples and 420 zone rows.

The generator shared the test host. Font and basemap requests were stubbed,
provider HTTP collection was disabled, and database/OS cache state was
uncontrolled. The 600-sample retention backlog was fixed. These results describe
that revision and workload; the slowest thirty-day cards had only 0.2 seconds
of margin against the ten-second target.

[PR #393](https://github.com/brentjColoS/ColoradoTrafficTracker/pull/393) records
the change and acceptance results. The
[measurement record](https://github.com/brentjColoS/ColoradoTrafficTracker/blob/main/docs/evidence/portfolio-measurements-2026-11-21.json)
preserves the settings, statistics, artifact hashes and fingerprints of the
original reports. A later release needs its own measurements before these
timings can describe it.

## Behavior under test

| Contract | Check |
| --- | --- |
| Competing collectors cannot overspend a quota bucket. | A [PostgreSQL connection race](https://github.com/brentjColoS/ColoradoTrafficTracker/blob/main/ingest-service/src/test/java/com/example/ingest_service/TrafficRequestBudgetPostgresTest.java) permits seven ten-request reservations from 12 contenders, then checks refund isolation by account, product, provider and month. |
| Archiving preserves the stored total and earliest timestamp. | A [database fixture](https://github.com/brentjColoS/ColoradoTrafficTracker/blob/main/api-service/src/test/java/com/example/api_service/StoredObservationDatabaseTest.java) moves an observation between the live and archive tables. |
| Incident writes preserve identity and update changed state. | [Writer unit tests](https://github.com/brentjColoS/ColoradoTrafficTracker/blob/main/ingest-service/src/test/java/com/example/ingest_service/IncidentEventWriterTest.java) use mocked SQL interactions to check duplicates, reactivation, rematching and malformed input. |
| Readers share work without cancelling another reader's result. | [Concurrent-reader tests](https://github.com/brentjColoS/ColoradoTrafficTracker/blob/main/api-service/src/test/java/com/example/api_service/DashboardWindowSummaryServiceTest.java) check coalescing, serialized cold calculations, disconnects, progressive frames and stage failures. |
| Refresh failure preserves the original fetch time. | A [PostgreSQL timeout test](https://github.com/brentjColoS/ColoradoTrafficTracker/blob/main/api-service/src/test/java/com/example/api_service/DashboardSectionCacheDatabaseTest.java) cancels a five-second query under a one-second transaction timeout, then checks retained timestamps and connection recovery. |

These contracts are explained in [Provider collection](Provider-Collection),
[Historical storage](Historical-Storage) and [Dashboard reads](Dashboard-Reads).
The database fixtures require explicit disposable-database configuration; a
local Maven run without it can skip them. Read the test report for the revision
being assessed to distinguish executed checks from skipped ones.

## Differential and boundary testing

[`HistoricalIncidentEpisodesDatabaseTest`](https://github.com/brentjColoS/ColoradoTrafficTracker/blob/main/api-service/src/test/java/com/example/api_service/HistoricalIncidentEpisodesDatabaseTest.java)
compares the episode reader with frozen reference SQL on the same PostgreSQL
fixture. Differential testing protects established results while the query
implementation changes. Cases include duplicate observations, case-sensitive
and Unicode identities, missing provider IDs, off-corridor reports, exact window
bounds and episode counts larger than a map-marker limit.

Cache tests use a controlled clock to cross freshness and retry boundaries
without waiting for real time. The
[publisher suite](https://github.com/brentjColoS/ColoradoTrafficTracker/blob/main/operations/portfolio/test_portfolio.py)
covers inclusive pagination, a non-advancing page, 23- and 25-hour Denver days,
missing observations and raw corridor minima. Failed publication must preserve
the previous snapshot; intraday updates must preserve the daily calendar and
its source values.

## From modules to the running application

| Layer | What it adds |
| --- | --- |
| Frontend regression tests | Calculations, timezone handling, source labels, map state and motion logic. |
| [Playwright scenarios](https://github.com/brentjColoS/ColoradoTrafficTracker/tree/main/scripts/tests/browser/specs) | Navigation, map lifecycle, filters, accessibility and mobile controls in Chromium. |
| [Packaged-runtime harness](https://github.com/brentjColoS/ColoradoTrafficTracker/blob/main/scripts/ci/browser_runtime.py) | The built API artifact running against disposable PostgreSQL fixtures. |
| Operational regressions | Monitoring decisions, interrupted backup recovery, checksums and delivery failure paths. |

The [browser-testing guide](https://github.com/brentjColoS/ColoradoTrafficTracker/blob/main/docs/browser-testing.md)
documents commands and scenario scope.

## Coverage, mutation testing and build provenance

JaCoCo measures line and branch coverage. PIT mutation testing changes selected
Java behavior and checks whether tests detect it. A covered line can still have
a weak assertion; the mutation report helps locate that gap.

API mutation shards consume compiled artifacts from the successful Maven job
in the same CI run. Revision and SHA-256 checks verify those inputs. The
aggregation gate requires matching class manifests, rejects duplicate or
misassigned mutations and enforces the module threshold across all partitions.
The shards retain the full selected analysis scope.

The [CI workflow](https://github.com/brentjColoS/ColoradoTrafficTracker/actions/workflows/ci.yml)
retains test, coverage and mutation reports, including reports from failures.
The [pipeline reference](https://github.com/brentjColoS/ColoradoTrafficTracker/blob/main/docs/ci-cd-pipeline.md)
explains job selection, artifact checks and gates. CI evidence belongs to its
exact revision. [Operations and reliability](Operations-Runbook) covers the
separate checks needed to verify a deployed release and its incoming data.

[← Data and interpretation](FAQ) · [Operations and reliability →](Operations-Runbook)
