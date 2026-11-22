# Dashboard read models

A read model organizes stored observations for a particular query or display.
The dashboard uses separate read models for snapshot sections, selected-window
cards and incident markers, each with its own availability and timing contract.
These reads do not contact traffic providers. A failed optional stage leaves its
value unavailable instead of substituting zero or current data.

Paths beginning with `/traffic/` below are relative to `/dashboard-api` for public
reads or `/api` under configured API-key protection. Observation times and window
bounds are distinct from the time a cached response was successfully fetched.

## Observation totals and snapshot freshness

`/traffic/database/observations` returns authoritative I-25/I-70 scalar totals
across live and archived rows, their sum and the earliest observation date.
One SQL statement sees both tiers at a single database snapshot. The query has
a one-second timeout and shares successes and failures for sixty seconds.
These totals exclude zone rows, map cells and incident events.

Successful sections can remain visible during asynchronous refresh for one extra
freshness interval, capped at sixty seconds. Their original fetch time and version
remain intact. Two workers and sixteen queue slots bound refresh work; background
database reads have a five-second read-only transaction deadline. Failed refreshes
wait five seconds before another attempt without renewing the last successful
fetch. Beyond the allowance, unavailable data is reported normally.

Health, operational status and observation totals require a current cache read.
Version-only replies carry freshness evidence without discarding existing values.
The browser makes at most two bounded follow-up snapshots, using its existing
budget and cooldown, and cancels them when hidden or leaving the page.

## Selected-window summaries

`GET /dashboard-api/traffic/dashboard/window-summary` accepts `corridors`,
`hours` (2, 6, 24, 168 or 720) and `asOf`. The `/api` alias uses the same contract
under configured API-key protection. Bounds are minute-aligned.

| Parameter | Contract |
| --- | --- |
| `corridors` | Optional; defaults to `I25,I70`. Accepts one or two entries from those identifiers, with duplicates removed. |
| `hours` | Required; one of 2, 6, 24, 168 or 720. |
| `asOf` | Required ISO 8601 timestamp with an offset, such as `2026-11-21T18:00:00Z`. At most one minute ahead of server time. |
| `progressive` | Optional; `true` selects the newline-delimited JSON response. |

Example request shape, using a fixed historical timestamp:

```http
GET /dashboard-api/traffic/dashboard/window-summary?corridors=I25&hours=6&asOf=2026-11-21T18:00:00Z&progressive=true
```

Ordinary JSON is keyed by corridor. Invalid parameters return 400. A 200 response
can contain partial or busy results: inspect `speedAvailable`, `zonesAvailable`,
`incidentsAvailable` and `busy` before interpreting values. Streaming-executor
rejection returns 503 with `Retry-After: 1`. The
[API reference](https://github.com/brentjColoS/ColoradoTrafficTracker/wiki/API-Reference)
covers shared access and rate-limit behavior.

| Field | Retained meaning |
| --- | --- |
| Speed | Mean of usable original observations inside the window, including archives. It is not an average of chart pixels or a whole bucket extending beyond the window. |
| Travel time | Sum of distance/speed for complete, contiguous zone coverage. Partial buckets are weighted by overlap; extrema use complete buckets. |
| Older travel fallback | When no zone observations exist, calculate distance/speed for each positive finite corridor observation using its recorded corridor extent, then aggregate those estimates. |
| Lowest speed | When no usable zone metric exists, use the lowest observed corridor-average speed without inventing a location. |
| Incidents | Count distinct durable events overlapping the window, or explicitly estimated legacy episodes where durable coverage is unavailable. |

Complete zone estimates take priority. Failed, incomplete or stopped zone
observations do not trigger the older-data fallback. `travelMethod` identifies
the calculation; none of these estimates represents a measured vehicle trip.
The corridor-extent boundary is cached for ten minutes.

### Progressive responses and capacity

`progressive=true` returns newline-delimited JSON (NDJSON): each line is a frame
with `summaries` and `complete`. Uncached work can expose speed/lowest observation,
then travel/zones, then incidents within one request. Cached or joined reads can
return only the final frame. `complete` marks the end of the response; field
availability still determines which calculations succeeded.

| Resource | Bound |
| --- | --- |
| Streaming executor | Ten workers, ten queue slots, fifteen-second timeout. |
| Distinct summary reads | Twenty admitted; identical minute/corridor/range selections share work. |
| Cold speed/zone calculation | One fair calculation at a time; admission waits up to eight seconds. |
| Joining reader | Up to twelve seconds; completed cached results bypass admission. |
| Completed summaries | At most 256 compact results, with fifteen-minute access expiry and freshness checks. |
| Archived incident work | Two cold queries, forty pending UTC-week blocks, ten-second shared deadline. |

A disconnected stream stops later work when no readers remain. A waiting reader's
deadline does not cancel shared reconstruction needed by another reader. Transport
workers do not raise database-calculation concurrency. Only completed results enter
the browser's 32-entry, minute-keyed cache; partial failures have shorter server
freshness. Busy capacity permits at most one delayed client retry. Sync now can
retry an unavailable result explicitly.

Freshness is separate from cache eviction. Cached partial results are fresh for five
seconds, complete recent-window results for sixty seconds, and complete older
windows for ten minutes. The fifteen-minute access expiry bounds retention of
cached entries; it does not make a response fresh for fifteen minutes.

### Legacy and durable incident seams

Coverage is checked separately for each corridor. Windows starting within durable
coverage count durable events. Earlier windows reconstruct legacy episodes using
the historical marker location/category filters and three-minute continuity rule.
Mixed windows take legacy episodes strictly before the durable boundary and
durable events from that boundary onward.

A matching provider identity continuing within three minutes across the seam
counts only on the durable side. Separate earlier episodes remain counted.
Rows without provider IDs retain approximate location/category identities and
cannot be proven to match a durable event. Mixed and reconstructed totals use
`RECONSTRUCTED_EPISODES`; they remain estimates. Failure of either source leaves
the count unavailable.

Reconstruction reads one UTC week at a time without marker geometry or raw
payloads. Each query has a five-second limit within the shared deadline. The
ten-minute cache holds at most 50,000 episode units including block overhead.
Concurrent readers share pending blocks; completed blocks survive a later batch
failure. Failed reads never become cached empty history. Bytewise identity
ordering avoids repeated locale-collation work without changing episode meaning.

## Browser scheduling and optional markers

Chart navigation takes priority. Cards use the final selected destination and
wait for its graph coverage, while the graph may still be easing toward it.
Reads settle for 50ms after button/keyboard input or 150ms after wheel input.
One cancellable read serves the visible corridors through the shared 48-per-minute
budget, two reserved live slots and Retry-After cooldown, with one independent
background slot. A slow summary cannot hold the foreground chart lane.

Prepared history batches use `includeIncidents=false`. After summaries settle,
`/traffic/dashboard/history/incidents` loads markers only for visible corridors
and bounds. Its latest 1,000-marker cap does not constrain the independent card
count. Completed marker windows are cached for ten minutes, with eight windows
and two capped corridor results each. Errors require Retry or another selection.
This is progressive loading by time window, not server cursor pagination.

New selections, Current, hidden tabs and page exit cancel obsolete browser work.
Client cancellation does not guarantee that a dispatched SQL query stops. Live
maps, incident panels, health and sync timestamps remain current during historical
chart navigation.

## Report and sign metadata

Incident projections expose stored reported mile-marker bounds. CDOT description
case and full source reports remain available; compact presentation does not
rewrite the source record. See [incident presentation](incident-presentation.md).

The variable-sign response keeps a one-hour `AVAILABLE` boundary. With six-hour
per-device collection, older successful values are normally `STALE`. An all-old
snapshot uses `LAST_REPORTED` and `lastReportedSignCount`; those readings do not
increase current available/below-regular counts. Source update time, read time
and failure states remain distinct. [Sign collection](i70-sign-ingestion.md)
documents optional retained history and display semantics.

The incident coverage repository uses PostgreSQL's native `Instant`, converting
to UTC offsets for query parameters. `IncidentBoundaryDatabaseTest` exercises the
real JPA boundary, including empty coverage, in an explicitly disposable database.
Its `CTT_COUNTER_DISPOSABLE_DB_URL` must identify that fixture, never production.

## Implementation and checks

| Contract | Implementation | Regression evidence |
| --- | --- | --- |
| Request validation and response formats | [Summary controller](../api-service/src/main/java/com/example/api_service/DashboardWindowSummaryController.java) | [Controller tests](../api-service/src/test/java/com/example/api_service/DashboardWindowSummaryControllerTest.java). |
| Coalescing, capacity, progressive stages and disconnects | [Summary service](../api-service/src/main/java/com/example/api_service/DashboardWindowSummaryService.java) | [Concurrent-reader and stage tests](../api-service/src/test/java/com/example/api_service/DashboardWindowSummaryServiceTest.java). |
| Legacy episode reconstruction | [Episode reader](../api-service/src/main/java/com/example/api_service/HistoricalIncidentEpisodes.java) | [PostgreSQL differential and boundary tests](../api-service/src/test/java/com/example/api_service/HistoricalIncidentEpisodesDatabaseTest.java). |
| Refresh failure preserves successful fetch time | [Section cache](../api-service/src/main/java/com/example/api_service/DashboardSectionCache.java) | [Database timeout and recovery tests](../api-service/src/test/java/com/example/api_service/DashboardSectionCacheDatabaseTest.java). |
| Observation totals survive archive moves | [Counter repository](../api-service/src/main/java/com/example/api_service/StoredObservationRepository.java) | [Live/archive continuity test](../api-service/src/test/java/com/example/api_service/StoredObservationDatabaseTest.java). |

Database cases require their explicit disposable-database settings. Inspect test
reports to distinguish executed checks from skipped cases.

See [coverage](data-history-coverage.md),
[browser measurements](../scripts/tests/browser/capacity/README.md) and the
[wiki read walkthrough](https://github.com/brentjColoS/ColoradoTrafficTracker/wiki/Dashboard-Reads).
