# Historical timeframe smoothing

Destination: `experiment/dashboard-reconstruction` only. Production promotion is
not authorized. Each phase used a separate topic branch from the latest accepted
integration. The combined candidate was checked locally before its experimental
sidecar rollout; no partial phase was released. Phase-specific evidence below is
historical; later verification and retry cleanup are recorded separately.

## Toolbar navigation

The current toolbar keeps First, earlier/later arrows, and Current beside the
Historical Scroll toggle. Navigation remains visible but disabled when scrolling
is off, including Retry if a failure has exposed it. Re-enable scrolling before
using Current to leave a locked historical window. Window details still collapse
when disabled. Normal hover instructions are omitted; loading, coverage, rate,
and failure notices remain. Wheel navigation arms after a 250 ms graph hover;
wheel input before readiness still scrolls the page and restarts the delay.
Controls use the existing wrapping layout and 48rem mobile breakpoint, with no
new viewport-specific behavior.

Timeframe buttons zoom historical graphs around their visible midpoint rather
than holding the right edge fixed. This also applies to a locked historical
window, without enabling wheel navigation. With scrolling enabled, shortening
Current zooms into the middle of its displayed window. Ordinary Current stays
live while scrolling is disabled. At the oldest usable full window or current
time, the new window is clamped rather than requesting outside retained coverage.
Alternate-frame preparation uses the same midpoint and existing finite budgets.

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

Validation at this phase: all 303 frontend tests and Java 21 clean verification/
coverage passed, with clean diff whitespace checks. The later combined native
assessment and sidecar rollout are recorded under Verified combined release;
this phase's test count is not the latest release total.

## Cursor-centered preparation

Coverage PR #194 passed all 20 checks and merged only into experimental at
`bd1a44d`. Branch `perf/history-cursor-preparation` starts from that accepted merge.
After navigation settles for 350ms, prepare at most three alternate batches per
selected-minute/mode around the exact selected time, prioritizing 24H and 6H from a long view. Other ranges
favor the nearest useful shorter view and the recently used range/companion mode.
Both corridors share these windows. Alternate ranges now prepare around the
displayed midpoint; same-range Overall/Speed zones switches retain the end time.

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
by this evidence.

## Verified combined release

All four topics (#194, #196, #197, #198) passed all 20 exact-head checks and
merged separately into experimental. The assessed topic tree matches accepted
`9818b77374c87125c733586b8469f4e2bd6db052` exactly. That combined revision was
released to the experimental sidecar and verified at 03:55 UTC on October 9
(October 8 in Denver). See the [release record](dashboard-history-smoothing-release.json).

Bounded native light/dark checks covered I-70 zones and I-25 Overall, Current and
historical windows, locking and corridor resets. Warmed 7D → 24H → 6H preserved
the same selected end without visible loading. Extra requests were finite 2H
preparation, not visible reloads. Draw time was 1.6–27.6ms and next paint
32.6–81.7ms in these synthetic scenes; no console errors were observed.
These are not universal latency promises or a measurement of live VPS browser rendering.

All 13 public assets match, including HTML except generated bootstrap. The
19-section bootstrap and 31-section all-view snapshot were available; all slices
succeeded. The live compact snapshot was 5,687,479 bytes; known-version response
was 5,150 bytes. One bounded 24H batch check for each mode succeeded, and the full
history endpoint retains provider/archive fields. Readiness, fresh flow/CDOT,
quota health, history continuity and timers passed. Production identities,
private configuration and routing were unchanged. Rollback image `4666327` remains.

Request allowances, animation code and full-DPR rendering are unchanged. Cold or
evicted intervals still need a read; preparation is finite, not a promise that
all history is resident. The temporary profiling preview was stopped after the
assessment. Existing user local containers/checkouts were not replaced.

Cold HTML bootstrap remains separately tracked in issue #192. Source, tests,
checked heads, accepted merges, runtime and next actions must be recorded at each
phase. Runtime before this work was `4666327`; starting integration was `e87910c`.
The user's primary checkout and existing local containers are preserved.

## Retry controls cleanup

The focused `fix/history-retry-controls` follow-up gives both history loaders one
bounded control-refresh timer at the latest server Retry-After deadline. It
re-enables Retry without fetching failed intervals. Hidden pages and pagehide
cancel the timer; returning restores the remaining wait or refreshes expired
controls. The server wait takes precedence over generic partial-history help.
An explicit retry after expiry clears the old rate warning; a new failure still
reports unavailable history and keeps Retry available.

Prepared and unprepared scrolling, renewed deadlines, successful and unsuccessful
retries, and visibility/back-forward-cache return have behavioral regressions.
The shared page budget, live reservations, server rate limits, finite preparation,
animations and full-resolution rendering are unchanged. The four HTML entry
points use the consistent `dashboard-history-retry-1` asset key.

PR #200 passed all 20 checks at exact head `1a457981`, including CI37888734427
and actual four-language CodeQL37888732489, and merged only into experimental as
`a9e3b926890994085e1006a97cb0c6883ca8b8ae`. All 314 frontend tests and full Java21
verification/coverage passed. The frontend/docs-only mutation exemption applied;
this is not a claim of a new full PIT run.

That accepted application was released and verified at 05:36 UTC October 9
(October 8 in Denver). All 13 public assets and HTML except generated bootstrap
matched. All 19 bootstrap and 31 all-view snapshot sections succeeded; both
bounded historical-mode checks passed. Readiness, fresh flow/CDOT, quota health,
unchanged oldest rows, nondecreasing counts and required timers passed. The
existing database role was verified SELECT-only with default read-only enabled.
Production containers, private configuration and routing were unchanged. The
previous `9818b77` image remains for rollback.
See [current release evidence](dashboard-history-retry-release.json).

This cleanup adds no native rendering benchmark or capacity claim. Earlier
native measurements remain tied to their historical release. Maintain this
stable sidecar; cold HTML bootstrap remains separate #192, not ongoing work.
