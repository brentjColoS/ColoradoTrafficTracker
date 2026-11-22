# Dashboard read models

Dashboard reads query retained observations without contacting traffic providers.
Snapshot sections, selected-window cards and incident markers have separate
availability and timing contracts. A failed optional stage cannot manufacture
a zero value or replace historical results with current data.

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

`progressive=true` returns NDJSON frames: speed/lowest observation, travel/zones,
then incidents. Ordinary JSON remains supported. One request carries all stages.

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

See [coverage](data-history-coverage.md),
[browser measurements](../scripts/tests/browser/capacity/README.md) and the
[wiki read walkthrough](https://github.com/brentjColoS/ColoradoTrafficTracker/wiki/Dashboard-Reads).
