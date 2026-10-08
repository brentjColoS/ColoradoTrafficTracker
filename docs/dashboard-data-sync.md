# Dashboard data sync

The dashboard previously warmed five ranges for two corridors every minute with
39 separate browser API requests. This topic keeps those warmed controls while
using one snapshot request for a normal sync. It also reduces repeated database
work; batching alone would only move the same work behind one HTTP request.

## Request and rendering contract

- `/dashboard/` forwards to the HTML controller. When public dashboard reads are
  enabled, the default 24-hour snapshot is embedded as escaped JSON. The browser
  paints that snapshot, then warms all five ranges in one background request.
- Without embedded data, the browser requests the selected range first, paints
  it, then warms the other ranges: two cold-start API requests. Subsequent syncs
  use one request. Demo and replay remain provider-free; historical mode uses
  retained observations and historical incident timelines.
- Both `/api/traffic/dashboard/snapshot` and the public
  `/dashboard-api/traffic/dashboard/snapshot` accept only the five supported
  ranges. The sidecar proxy exposes the existing experimental prefix. No new
  proxy route, credentials, database schema, migration, or ingestion is needed.
- Each response section carries its own HTTP-equivalent status, opaque version,
  and actual fetch timestamp. A `known` version hint suppresses unchanged bodies.
  Failed sections remain failures, and the existing UI retains useful earlier
  slices with a retry message. A successful request does not make old observations
  fresh: provider/sample timestamps still determine displayed freshness.
- Hidden pages skip periodic syncs and cancel pending snapshot/history reads.
  One browser scheduler runs at most one batch at a time, prioritizes snapshots,
  honors `Retry-After`, and bounds batch attempts to 48 per rolling minute.
  History stops at 46 attempts, reserving two slots for current snapshots; queued
  reads cancel immediately even while the request budget is paused.
- First map initialization still reads its configuration. Map tiles, static
  assets, history coverage (two reads when first enabled), and other website
  pages are outside the one-request dashboard-sync count. Other pages do not
  mount or fetch merely because the dashboard warms its five ranges.

The HTML response is `no-store`. Bootstrap avoids a visible client data-loading
round trip, but a cold backend must still finish its bounded database reads before
sending HTML. Fixture checks demonstrate rendering and request behavior, not a
live latency guarantee or VPS load measurement.

## Shared server reads

`DashboardDataService` reuses sections across visitors, with one in-flight load
per cache key. Its eviction budget is 32 MiB of serialized payload estimates,
plus a 12-hour idle expiry; this is not a literal Java heap bound. Failed loads
retry after five seconds. Existing controller cache proxies remain in use.

| Dataset | Maximum reuse before checking again |
| --- | --- |
| Health and operational status | 20 seconds |
| Corridor catalog | 5 minutes |
| Lightweight current summary, overall trend, detailed speeds, current flow map | 60 seconds |
| Selected zone range and daily 24-hour zone observations | 60 seconds |
| Inactive 2H / 6H / 7D / 30D zones | 1 minute / 5 minutes / 1 hour / 3 hours |
| Inactive long-range flow frequency | 1 hour; selected range 60 seconds |
| Baselines | Denver-week key, up to 7 days |
| Anchored historical chart sections | 10 minutes |

An inactive longer view can show its warmed, older snapshot immediately on
selection; the next normal sync refreshes it at the selected cadence. Overall
trends and current summaries stay current for every view. The lightweight summary
returns only the latest usable observation and provider state needed by the UI,
avoiding unrelated summary analytics and repeated incident queries.

## Incident correctness

One shared 30-day incident set per corridor replaces the five overlapping recent
incident reads. The browser applies the same two independent predicates as the
original database query:

```
(eventActive || lastSeenAt >= cutoff)
&& (corridorActive || lastMatchedAt >= cutoff)
```

Both activity flags and the last corridor-match time are carried in the feature
properties. This preserves active old events and avoids retaining events that
ceased matching this corridor outside the requested window. Corridor and
mile-marker filtering remains in the existing repository query.

A lightweight database revision read per corridor detects published event or
corridor-match changes, including closures. The shared set is reused until that
revision changes, or for at most 15 minutes. It is rebuilt once per corridor,
rather than once per range per visitor. Cache eviction can cause an earlier read.
The revision itself is checked on each snapshot; zero database reads is not the
claim. No provider request is made by this API.

The query requests 1,001 rows to distinguish exactly 1,000 from actual overflow.
If it overflows, the batch includes the original independently capped recent
windows. That preserves short-window coverage and truthful limit messages; it
costs additional internal reads but still one browser request. This topic does
not introduce incident pagination or claim complete coverage above that cap.
Historical scrolling continues using the anchored timeline, never today's live
activity flags.

## Historical-scroll integration

`/traffic/dashboard/history` batches chart-only resources for selected corridors,
range, view, and `asOf`. Concurrent I-25/I-70 calls to the existing
`loadChartHistoryRoute(corridor, hours, end, view, signal)` share one request.
The zone resolutions remain 1 / 5 / 15 / 60 / 180 minutes for 2H / 6H / 24H /
7D / 30D; weekly baselines remain specific to the historical Denver week.
Cancellation prevents late responses from replacing a newer window.

The other active chat, **Assess data pulling refactor**, has an unreviewed
continuous timeline prototype at `71b57e8` (with `ab8fac2`). It prefetches three
older intervals and the immediate newer interval and retains bounded chart
buffers. This topic preserves its loader interface, supplies coalesced reads,
and leaves heavy historical observations owned by the graph buffer rather than
retaining another copy in the sync-version cache. The prototype renderer is not
transplanted into this PR. Its larger buffer and client read-budget assumptions
need to be reconciled when integrating that separate topic; the old 39-request
normal-sync reservation is no longer necessary.

## Delivery checkpoint

- Checkout: `/private/tmp/ctt-dashboard-sync`
- Branch: `feature/dashboard-data-sync`
- Base: `experiment/dashboard-reconstruction` at
  `9755d3ff3de248bbc93eca42369d7e199250fa24`
- PR: [#180](https://github.com/brentjColoS/ColoradoTrafficTracker/pull/180),
  merged into the experimental integration at
  `833600f6ef7054e5076bd3fd352f049469040aea`. All 20 checks passed on
  implementation head `3e9a9665036bdce3f44cd04114bd35f859da0b07`.
- Scope: new implementation, not a replay of pending graph commits.
- Local validation: 245 dashboard tests; full `./mvnw clean verify` (all modules
  and coverage gates; JDK 24 compiling Java 21 target); resilience/replay shell
  suite and both Compose renders; native browser fixture audit.
- Browser evidence: hydrated default view plus one warm request; cached range,
  corridor, and zone switches; one-request manual sync; two coverage reads on
  first history activation followed by one chart batch for both corridors; no
  browser console errors in this audit.
- User-authorized sidecar deployment verified on October 8, 2026 at 03:19 UTC.
  Production remains on `main` at `8e48accb2552e1c9aaf4da545b1c901b7ea55606`;
  its containers, private configuration, Caddy routing, retained history, and
  required timers are unchanged. Both TomTom accounts are healthy and available.
- Public default HTML contained 19 successful sections; the all-range batch
  contained 31. Public warm HTML took 0.243 seconds; a known-version batch took
  0.034 seconds and returned 5,151 bytes. The full initial all-range payload was
  about 7.5 MB before compression and 568 KB with public gzip encoding. These
  measurements are bounded checks, not a load-test or latency guarantee.
- The isolated cold candidate took 5.573 seconds for its first HTML snapshot,
  then 1.226 seconds to warm all ranges and 0.014 seconds for a cached sync.
  Deployment verification warmed the new instance before handoff. Cache resets
  still have a cold-start cost; the embedded snapshot removes the subsequent
  client data-loading round trip.
- Real database incident IDs matched the existing API in all five windows for
  both corridors (232 and 236 shared events); anchored overall and zone history
  succeeded. The browser showed populated real-data summaries and cached ranges
  without console errors. No provider requests or migrations were introduced.
- Rollback image `654fb1b41552070b1ed5474770fcd2d0121985ce` remains available.
  From the sidecar worktree, run
  `./scripts/experimental-dashboard.sh rollback 654fb1b41552070b1ed5474770fcd2d0121985ce .env.experimental`
  if required; it restores only the sidecar image.
- Sanitized deployment and assessment evidence is recorded in
  [dashboard-data-sync-release.json](dashboard-data-sync-release.json).
