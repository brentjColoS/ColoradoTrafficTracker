# Shared historical blocks

## Delivery boundary

Topic: `feature/dashboard-shared-history` in `/private/tmp/ctt-shared-history`.
Parent: accepted experimental integration `223918bf4c64f45d09bd3dafaf09e6cb4dfcb31d`.
PR destination: `experiment/dashboard-reconstruction`, not `main`.
The original task authorized implementation and local validation. On October 8,
the user subsequently authorized releasing the validated update to the VPS
experimental sidecar and continuing improvement on a separate topic. This does
not authorize production UI promotion or changes to `main`.

PR #185 (`feature/dashboard-chart-view-switching`, checked head `f94c38e`) was
accepted separately at `2bc8104`. PR #186 was reconciled with that accepted parent,
revalidated with 283 frontend tests, full Maven/coverage and all twenty actual
CI/security checks on `2053d31`, then normally merged into the experimental
integration at `70cc33d`. Its public release is recorded in
[the sidecar verification record](dashboard-history-release.json). Production
remains unchanged. Further preload work uses its own topic branch.

## Behavior

The existing `/dashboard-api/traffic/dashboard/history` envelope, exact `asOf`
resource keys, version hints, status handling and browser resolutions remain.
The server now assembles overlapping historical observations from reusable UTC
blocks instead of repeating every whole-window query:

| Dataset | Resolution | Block width |
| --- | --- | --- |
| Overall trend | Existing hourly aggregate | 24 hours |
| Detailed speed history | Original archive-inclusive samples | 2 hours |
| 2H zones | 1 minute | 2 hours |
| 6H zones | 5 minutes | 6 hours |
| 24H zones | 15 minutes | 24 hours |
| 7D zones | 1 hour | 24 hours |
| 30D zones | 3 hours | 72 hours |

Contiguous missing blocks load together. One cold block loader per API process
coalesces overlapping cold requests and bounds their database concurrency; a
waiter times out after five seconds rather than building an unlimited queue.
Warm blocks bypass that loader. The cache has a 16 MiB serialized-weight target
and twelve-hour idle expiry. This is a payload-weight budget, not an exact JVM
heap measurement. A response larger than the target completes from local
references instead of continually reloading blocks evicted during assembly.

Blocks ending within the latest hour expire after sixty seconds; older blocks
expire after ten minutes. These are not immutable archives: corrections are
eventually reread. The existing exact historical-envelope cache still lasts ten
minutes. Current snapshots keep their independent sixty-second observations;
historical cold loading does not take ownership of live refreshes.

Zone averages remain weighted by the original observation counts. Each exact
window's partial first and last buckets are freshly aggregated from the raw
observations in one bounded edge query, replacing rather than clipping cached
whole-bucket averages. Road definitions, posted limits, descriptions, minimum
speeds and counts remain distinct. The SQL bucket origin explicitly includes
`+00` so three-hour alignment cannot shift with a JDBC connection's timezone.
The inclusive window end and PostgreSQL microsecond precision are preserved.

Detailed history keeps its existing latest-row limit. Capped multi-block reads
split into two-hour reads. If an individual block is still capped, the original
exact-window query is used: a capped block is never cached as complete and cannot
hide earlier samples when the requested end lies inside it. Weekly Denver-time
baselines and capped incident timelines retain their existing query semantics.

## Browser scheduling

Continuous scrolling still uses the accepted full-resolution renderer, fixed
axes, fractional movement and bounded interval buffers. No animation, smoothing
or reference-band quality was reduced. Both corridors share one batch; the
48-request/minute page budget and two reserved live slots remain unchanged.

An actual history response taking at least two seconds delays the next
speculative read by twice its duration, capped at thirty seconds. A missing
visible interval bypasses this additional cooldown, while still obeying the
minimum four-second dispatch spacing, shared scheduler and server Retry-After.
Changing navigation promotes visible work even while a speculative timer waits.
Slow successful reads resume automatically; genuinely failed intervals still
require Retry. Neither the per-IP limit nor any provider allowance was raised.

## Validation

Focused block regressions cover overlapping reuse, archive fields, inclusive
exact bounds, capped-history fallback, weighted partial edges, changed zone
definitions, all five ranges, offsets/DST, TTLs, failures, simultaneous reads,
interruption, serialization failure and oversized responses.
All 274 frontend regressions and full Maven verification passed locally.
The opt-in retained-database check is skipped in ordinary CI and was separately
run here with read-only connections and a fifteen-second query timeout.

That finite check compared both corridors at all five ranges against direct
weighted queries, then compared one-minute-shifted overlapping windows. Counts,
metadata, timestamps and minima matched exactly; averages matched within
`1e-9` mph (PostgreSQL floating-point summation order can differ). Cold reads
used two queries; overlapping reads used only the edge query. Local measured
30D results were I-25 246 ms cold / 23 ms overlap and I-70 148 ms / 13 ms.
These retained-data measurements are evidence of reuse, not VPS latency,
multi-user capacity or universal frame-rate guarantees.

Runtime image verification, final CI evidence and local shutdown are recorded
in the completion checkpoint below once actually performed.

## Rollback and remaining limits

Revert the two focused functional commits to restore the old window reads and
fixed prefetch cadence. There are no migrations, persisted cache files, new
services or data changes to undo. The subsequently authorized sidecar rollout
changes no production service, schema, provider configuration, or data. The
previous `833600f` sidecar image remains available for rollback.

Uncached blocks still require database work, and baseline/incident reads retain
their existing costs. Caches are shared within one API process, not between
replicas. Browser request budgets remain per page, not shared between tabs.
Use a bounded production-side read assessment if a separately authorized rollout
reveals materially different costs; a new rollup service is not justified by
these local measurements.
