![Colorado Traffic Tracker](https://raw.githubusercontent.com/brentjColoS/ColoradoTrafficTracker/main/docs/assets/ctt-wordmark.svg)

Historical browsing can request speed statistics, estimated travel times and
incident reconstruction for the same window. The API bounds that work and
preserves the age and availability of each result, including when part of a
request fails.

## Request coalescing and backpressure

[`DashboardWindowSummaryService`](https://github.com/brentjColoS/ColoradoTrafficTracker/blob/main/api-service/src/main/java/com/example/api_service/DashboardWindowSummaryService.java)
normalizes an in-flight request by sorted corridor set, window length and UTC
end minute. Requests for `I25,I70` and `I70,I25` ending within the same minute
can join one `CompletableFuture` rather than calculate the window again.
This single-flight pattern prevents duplicate work for the same normalized key.

Distinct cold windows compete for a fair lock that serializes speed/travel
calculations. A semaphore admits at most 20 owning reads. This provides
backpressure through admission control and bounded waits: at the limit, the
service returns a busy summary without starting another cold calculation.

### Why these limits are separate

The coordination change addressed a measured contention problem: in the earlier
ten-session baseline, one card request completed while nine immediately returned
busy. [PR #375](https://github.com/brentjColoS/ColoradoTrafficTracker/pull/375)
introduced fair waiting and shared work; its unchanged diagnostic workload then
completed all 50 reads. Database calculation concurrency was kept bounded while
requests gained a chance to wait for useful results.

The admission cap of 20 matches the streaming executor's ten workers and ten
queue slots, defined in
[`DashboardSummaryStreamingConfig`](https://github.com/brentjColoS/ColoradoTrafficTracker/blob/main/api-service/src/main/java/com/example/api_service/DashboardSummaryStreamingConfig.java).
Summary admission also applies to ordinary JSON reads; these transport slots
do not increase database calculation concurrency.

| Boundary | Code-level limit | Reason for the boundary |
| --- | --- | --- |
| Join an existing summary calculation | 12-second wait. | Let readers await work already in progress, with a finite wait. |
| Enter the cold calculation lock | 8-second wait. | Absorb short contention through a fair queue while bounding time spent waiting to start. |
| Reconstruct incidents for the selected corridors | One shared 10-second deadline. | Share one reconstruction budget across both corridors. |
| Keep calculated summaries in memory | At most 256 cache entries. | Bound the number of corridor/window/minute selections retained in this cache. |

These limits apply per API process. The waits constrain separate paths, and
streaming has its own 15-second transport timeout; they do not form a combined
response-time guarantee. The [recorded workload](Testing-Strategy) shows behavior
for one cohort and revision, without establishing optimal settings or general
user capacity.

## Progressive responses preserve independent results

With `progressive=true`, the window-summary endpoint emits NDJSON frames as
stages become available:

```text
speed fields for the requested corridors
    -> travel fields
    -> incident counts
    -> complete frame
```

The progressive owner releases the cold calculation lock before incident
reconstruction. An older archive lookup therefore does not hold up the next
window's early speed and travel fields. The owner emits intermediate frames;
readers joining its in-flight future receive the completed shared result.

Reader counts also govern cancellation. A disconnected owner does not cancel
work another reader still needs. When no reader remains, later expensive stages
can stop and admission capacity is released.

Availability is tracked by stage. An incident timeout leaves already calculated
speed and travel fields intact, with the incident count unavailable. Missing
data is not replaced with zero incidents or a live value from another window.

## Stale-while-revalidate with bounded freshness

[`DashboardSectionCache`](https://github.com/brentjColoS/ColoradoTrafficTracker/blob/main/api-service/src/main/java/com/example/api_service/DashboardSectionCache.java)
can return an eligible expired success while one background refresh runs.
The retained response keeps its original `version` and `fetchedAt` and is marked
`refreshing`. A failed refresh is stored separately; it does not make the older
success appear newly fetched.

For an eligible section with a 60-second lifetime, the behavior is:

| Age since the successful fetch | Result |
| --- | --- |
| Less than 60 seconds | Serve the fresh result. |
| 60 to less than 120 seconds | Serve the same version with its original timestamp and coalesce background refreshes. |
| Refresh fails | Retain the original evidence within its existing grace period. |
| 120 seconds or later | The old result is outside that grace period. |

Eligible sections get one extra freshness interval, capped at 60 seconds:
`min(lifetime, 60 seconds)`. This gives short-lived sections proportionate grace
while limiting how long a delayed refresh can keep older values visible.
Health, system-status and database-count keys exclude this path so retained
successes cannot mask their current status.

Two workers and a 16-job queue bound active and pending background loads during
an expiry burst. A five-second failure cooldown suppresses repeated attempts
while a dependency recovers. Cache entries share a 32 MiB weighted budget based
on serialized payload size plus an entry estimate; this is payload accounting,
not a whole-JVM heap limit. These controls do not reserve dedicated database
connections. A cold waiter's timeout also does not declare the shared loader
failed. [PR #376](https://github.com/brentjColoS/ColoradoTrafficTracker/pull/376)
records the expiry, saturation and query-cancellation checks.

`fetchedAt` describes the API fetch. The freshness of the traffic itself still
comes from observation timestamps inside the payload. Those are separate clocks.

## Timestamp pagination and its limits

The raw history endpoint has a separate contract from window summaries: a
speed-only request returns at most 2,000 rows over seven days. The image publisher
uses the earliest returned `polledAt` as the next inclusive `asOf`, deduplicates
sample references and filters the result to its target time range.

This is cursor-style pagination using a timestamp, with no `(timestamp, id)`
tie-break cursor. If a full page cannot move the timestamp backward, the
publisher rejects the incomplete read. It does not silently publish a calendar
from only the returned subset. Pagination also does not establish one database
snapshot across multiple HTTP requests.

[`history` and `daily_history`](https://github.com/brentjColoS/ColoradoTrafficTracker/blob/main/operations/portfolio/publish.py)
then group original observations by America/Denver date. The tests cover
inclusive page overlap, a non-advancing page and 23- and 25-hour days. Historical
corrections require an explicit calendar rebuild.

## Counts across an incident-history boundary

Incident coverage is determined per corridor. A recent window can count durable
events directly; an older window reconstructs episodes from retained reports.
A window crossing the boundary combines the older episodes with the durable
side and deduplicates continuing provider identities near the seam.

The seam rule checks a three-minute continuation interval. Missing provider IDs
require approximate legacy identities, so a mixed count is labeled
`RECONSTRUCTED_EPISODES`. Failure in either source leaves that combined count
unavailable. Map marker limits do not cap the analytical count.

The [window-summary contract](https://github.com/brentjColoS/ColoradoTrafficTracker/blob/main/docs/dashboard-window-summaries.md)
documents the seam semantics, and
[`HistoricalIncidentEpisodes`](https://github.com/brentjColoS/ColoradoTrafficTracker/blob/main/api-service/src/main/java/com/example/api_service/HistoricalIncidentEpisodes.java)
implements bounded weekly reconstruction with shared deadlines and cache work.

## Evidence to inspect

- [`DashboardWindowSummaryServiceTest`](https://github.com/brentjColoS/ColoradoTrafficTracker/blob/main/api-service/src/test/java/com/example/api_service/DashboardWindowSummaryServiceTest.java)
  checks ten readers sharing a window, ten distinct windows serializing cold
  calculations, disconnect ownership, early frames, shared archive deadlines,
  unavailable fields and an incident fixture larger than the marker cap.
- [`DashboardSectionCacheTest`](https://github.com/brentjColoS/ColoradoTrafficTracker/blob/main/api-service/src/test/java/com/example/api_service/DashboardSectionCacheTest.java)
  advances a controlled clock through expiration and failure, checks original
  evidence, queue saturation and same-key cold loads.
- [`DashboardSectionCacheDatabaseTest`](https://github.com/brentjColoS/ColoradoTrafficTracker/blob/main/api-service/src/test/java/com/example/api_service/DashboardSectionCacheDatabaseTest.java)
  runs a five-second PostgreSQL sleep inside a one-second read-only transaction
  and checks cancellation, retained timestamps and connection recovery.

[← Historical storage](Historical-Storage) · [Testing and verification →](Testing-Strategy)
