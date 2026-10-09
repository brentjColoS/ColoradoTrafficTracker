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

## Remaining separate topics

1. Visible-demand scheduling without the artificial speculative delay. Preserve
   the shared budget, live reservations, single-flight reads and Retry-After.
2. Compact chart payloads and bounded selective rendering, measured against a
   short cold/warm sequence. Add no service or worker without actionable evidence.

Cold HTML bootstrap remains separately tracked in issue #192. Source, tests,
checked heads, accepted merges, runtime and next actions must be recorded at each
phase. Runtime before this work is `4666327`; accepted integration is `e87910c`.
The user's primary checkout and existing local containers are preserved.
