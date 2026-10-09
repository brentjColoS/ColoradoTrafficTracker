# Historical timeframe smoothing

Destination: `experiment/dashboard-reconstruction` only. Production promotion is
not authorized. Each phase uses a separate topic branch from the latest accepted
integration. The final combined candidate will be checked locally before an
experimental sidecar rollout; no partial phase is a release.

## Coverage correctness

Branch `fix/history-window-coverage` starts at accepted `e87910c`. Cache pressure
removes distant chunks rather than whole inactive views. Visible chunks remain
protected, with the existing 32-chunk/60,000-record soft limits and 12-chunk active
limit. Evicted speculative intervals are not automatically downloaded again.

Coverage is determined from retained time intervals, including the single live
overlay. A newly selected view receives its current snapshot head without moving
the historical grid. Reads at the head are capped at the actual latest time.
Explicit timeframe selection can load a missing historical interval with wheel
navigation disabled; disabling scrolling does not discard the locked time.
The tooltip distinguishes retained selected coverage from the startup preparation
count. Loading text requires an actual scheduled or running read.

Focused regressions cover locked-window selection, an hour of elapsed live time,
and cache pressure after visiting all views. Existing tests continue to protect
partial failures, no automatic retry loops, rates, hidden-page cancellation,
real gaps, zone definitions and high-resolution rendering.

Local validation: all 303 frontend tests and Java 21 clean verification/coverage
passed. Diff whitespace checks passed. Native combined-candidate assessment is
pending; this is not a claim of browser latency measurements or a sidecar release.

## Cursor-centered preparation

Coverage PR #194 passed all 20 checks and merged only into experimental at
`bd1a44d`. Branch `perf/history-cursor-preparation` starts from that accepted merge.
After navigation settles for 350ms, prepare at most three alternate batches per
selected-minute/mode around the exact selected time, prioritizing 24H and 6H from a long view. Other ranges
favor the nearest useful shorter view and the recently used range/companion mode.
Both corridors share these windows; changing range does not move the locked time.

This finite speculative burst uses the existing single-flight scheduler and
budget, reserved live slots, Retry-After and slow-read backoff. It does not repeat
failed or evicted intervals or run cursor preparation with wheel scrolling
disabled. Returning from hidden-page cancellation can resume unfinished work.
Each zone range retains its own server aggregation resolution and definition
identity. No finer observations are synthesized from a coarse view.

All 306 frontend tests and Java 21 clean verification/coverage passed locally.
The exact historical time, failed-read termination, moving-position coalescing
and absent alternate coverage have dedicated regressions.

## Demand scheduling

Cursor PR #196 passed all 20 checks and merged only into experimental at
`1143180`. Branch `perf/history-demand-scheduling` starts at that accepted merge.
Visible missing intervals bypass the artificial four-second speculative delay.
The shared request budget, live reservations, single-flight queue, Retry-After
and speculative slow-read backoff still apply. Earlier eligible finite warming
can replace an obsolete later timer rather than waiting behind it.

Already dispatched compatible reads can finish into their original buffer across
historical timeframe/mode switches. They cannot reopen the old graph or replace
the selected time. Current, corridor resets, hidden pages and navigation still
cancel obsolete work. Locking wheel scrolling does not restart a visible read.
The shared asset release token changes on all four pages, retaining their existing
consistency contract so a cached pre-fix loader is not reused on release.

All 308 frontend tests and Java 21 clean verification/coverage passed locally.
Focused tests cover immediate visible dispatch with live capacity preserved and
compatible in-flight reuse without restoring an obsolete selection.

## Compact chart history

Demand PR #197 passed all 20 checks and merged only into experimental at
`032a1fe`. Branch `perf/dashboard-compact-chart-payloads` starts there.
Dashboard snapshot/history batches project detailed samples to the twelve fields
needed for plotting and canonical/fallback repeat identity. Metadata and sample
counts remain unchanged; missing values remain missing. The public full-history
endpoint, summary/latest, archive-inclusive reads, canonical block cache, query
counts, cache limits/lifetimes and request allowances are unchanged.

Projection of the captured real snapshot (2,732 detailed samples) reduces JSON
from 7,489,142 to 5,670,680 bytes and gzip from 524,490 to 392,580 bytes: about
24–25%. These are offline payload comparisons, not a universal browser latency
guarantee. Behavior tests compare complete plotted series and repeat states, and
verify metadata, missing observations, failed slices and known-version reuse.
All 309 frontend regressions and Java 21 clean verification/coverage passed locally.

Bounded native assessment before this topic found Current switches at full DPR 2
with 28–56ms next-paint latency and no additional reads in the fixture. Historical
I-70 zone switches retained the same time without a visible loading notice;
background prefetch can still produce a request. Long-task observation was not
supported in that browser. No worker, library or rendering rewrite is justified
by this evidence. Final combined-candidate validation and rollout remain pending.

Cold HTML bootstrap remains separately tracked in issue #192. Source, tests,
checked heads, accepted merges, runtime and next actions must be recorded at each
phase. Runtime before this work is `4666327`; accepted integration is `e87910c`.
The user's primary checkout and existing local containers are preserved.
