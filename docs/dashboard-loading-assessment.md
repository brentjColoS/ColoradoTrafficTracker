# Historical loading assessment — October 8

The user authorized releasing checked PR #188 to the experimental sidecar, then
assessing restrictions and remaining improvement opportunities. The accepted
release is `a284bec0a130995df3e5d025661be7f355a53352`. This assessment does not
change production, provider budgets, database contents, rate limits or cache sizes.

## Bounded evidence

[The release record](dashboard-prepared-release.json) contains exact runtime and
measurement evidence. The release passed public asset identity, readiness,
I-25/I-70/CDOT freshness, quota health, archive continuity, timers, read-only
security, preserved rollback image and unchanged production/configuration checks.

One subsequent finite sequence requested the existing five-range snapshot and
fourteen sequential history batches through the public sidecar API, using gzip
and the browser's baseline version hints. Current snapshots and some overlapping
blocks were already warm from release verification; other historical sections
were newly requested. No providers were contacted and no concurrent stress run
was performed. The sequence stopped on a failed section or unusually slow read.

- Snapshot: 0.309 seconds, 559,647 transferred bytes, 7,488,165 decoded JSON bytes.
- Fourteen historical batches: 4.027 seconds total; individual reads 0.030–0.963
  seconds; 957,597 transferred bytes, 11,799,866 decoded JSON bytes.
- Every section succeeded. The actual rate limit was 120/minute; 105 slots
  remained after the snapshot and fourteen requests in that server minute.
- No read crossed the two-second slow-read threshold. The projected additional
  cooldown for this sequence was zero.
- Sidecar cgroup memory went from 401.3 to 410.0 MiB, with a 414.0 MiB peak since
  container start, under its 1536 MiB cap. Snapshot plus preparation consumed
  3.154 CPU seconds under the existing 1.5-CPU cap.
- Release verification separately measured a new 30-day zone window at 1.490
  seconds, a minute-shifted overlap at 0.517 seconds, and known versions at 0.013
  seconds. VPS available memory was 3464 MiB and free disk was 28 GB.

These are one-session server/transfer checks from the VPS, not end-user browser
latency, browser heap, frame-rate, cold-all-caches or concurrent-user measurements.
Internet round trips, slower connections, JSON parsing and drawing still add cost.
The 0.180-second release HTML check followed the deployment helper's HTML check;
it must not be described as a cold bootstrap measurement.

## Restrictions and their effect

| Restriction | Current behavior | Assessment |
| --- | --- | --- |
| Batched browser reads | 48/minute; historical work stops at 46 to reserve two live slots | Not reached by the finite preparation sequence. Keep it. Coverage and some map reads use separate fetch paths; this is not a limit on every page request. |
| Server limit | 120 requests/minute per IP or authenticated client, separate production/sidecar processes | Keep it. Multiple visible tabs or visitors sharing an IP can reach it despite each page's budget. Background tabs pause work; no cross-tab budget is shared. |
| Request concurrency | One in-flight browser batch; live, visible history, then speculative priority | Keeps background loading bounded. In-flight speculative work cannot be overtaken by live work; do not increase concurrency against the shared production database without evidence. |
| Dispatch pacing | Four seconds between ordinary historical dispatches; finite initial prepared reads bypass that delay | Strongest avoidable delay when scrolling beyond prepared history. A fast server response does not shorten this floor. Raising the request budget will not remove it. |
| Slow-read cooldown | Responses taking at least two seconds defer speculative work by twice their duration, up to thirty seconds; visible work bypasses this additional cooldown | Keep overload protection. Browser transfer/parse time contributes to this signal, so a slow connection can pause preparation even when the database is fast. |
| HTTP limits | Server Retry-After respected; 15-second fetch deadline; failed intervals require explicit Retry | Keep truthful failures and bounded waits. Increasing timeouts would prolong stalls rather than improve normal latency. |
| Browser working set | Ten scopes, thirty-two total chunks, twelve per active scope, 60,000 distinct graph-record soft target | Nearby prepared history is bounded, not all history. Visible intervals can exceed the soft target. Eviction avoids retry loops. Record counts are not a byte/heap limit. |
| Raster budget | Full existing resolution, DPR up to two; twelve-million-pixel/8192-pixel strip bounds with full-resolution redraw fallback | Preserves visual quality but exceptionally tall zone graphs can redraw more expensively. Do not reduce resolution to disguise loading latency. |
| Server caches | 32 MiB serialized-weight section cache; 16 MiB historical-block cache; twelve-hour idle eviction | Current evidence shows useful overlap reuse, not a demonstrated capacity problem. These weights are not exact JVM heap usage; do not raise them blindly. |
| Cache freshness | Recent blocks sixty seconds, older blocks ten minutes; historical sections ten minutes; weekly baselines seven days | Preserves eventual rereads/corrections. Longer retention of entries is not permission to treat historical observations as immutable. |
| Cold-read loader | One historical block loader per API process, five-second lock wait; warm reads bypass it | Protects database concurrency. It does not serialize every API/baseline/incident query. Raising rate limits could add waiters rather than improve throughput. |
| Live refresh | Sixty-second sync, fifteen-second manual cooldown; busy cycles do not queue | Keep it. More frequent ingestion/display polling is unrelated to smooth historical scrolling. |
| Scroll capture | Three-second hover; corridor changes reset Current and disable scrolling | Intentional interaction safeguards, not network bottlenecks. Keep them. |

Historical reads use stored data, not TomTom or CDOT requests. Provider allowances
are a separate ingestion constraint and should not be raised for graph scrolling.

## Recommended next topics, in order

1. **Adaptive on-demand pacing.** On a separate branch from the latest accepted
   experimental tip, test replacing the four-second floor for prepared-mode
   on-demand reads with a shorter measured floor, while retaining one in-flight
   request, 48/46 budget, live priority, slow-response backoff and Retry-After.
   Start with a one-second dispatch floor, not zero delay or more concurrency.
   Fast adjacent/overlap reads measured here justify an experiment, not an
   unrestricted rollout. Verify fast scrolling beyond the prepared strip,
   rapid reversals, live refresh competition, slow reads and 429s. Use one short
   interaction scene per failing case, not a sustained load sweep.
2. **Nonblocking cold page delivery.** The HTML controller synchronously computes
   a complete 24-hour snapshot before returning the page. Earlier release
   verification observed a 5.301-second HTML response. Investigate a cache-only
   bootstrap or immediate shell plus the existing selected-view-first fetch.
   Preserve no-store, script escaping, truthful unavailable states and fresh
   data. Do not add a second polling service or duplicate cold reads.
3. **Direction-aware preparation only if deeper navigation still misses.** Use
   the current working-set budget to favor the user's direction and likely
   alternate views. Keep resolutions, posted-zone changes and weekly baselines
   distinct; reuse exact same-time data where valid. Loading all retained history
   or manufacturing finer detail from coarse aggregates is not appropriate.

Do not increase 120/minute, 48/minute, CPU, memory, cache weights or historical
TTLs based on this single successful session. The actionable bottleneck is
ordinary on-demand pacing and remaining cold critical paths, not a rate limit
that this preparation sequence never approached. No new library or service is
needed to test those focused improvements. Implementation remains a subsequent
topic; this release records the evidence without silently changing its behavior.
