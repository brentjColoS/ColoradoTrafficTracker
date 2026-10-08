# Historical scrolling integration

## Delivery boundary

Accepted base: `65e66e77ecfbdf7e8694ac4127e8cd19491df256`.
Destination: `experiment/dashboard-reconstruction`, never `main`.
The original prototype remains preserved at
`71b57e8cf6964e0bb1d5e79a3bfb85b384ac83de` on
`experiment/dashboard-continuous-timeline`.
This integration does not authorize a VPS deployment or provider requests.

## Ordered topics

1. `feature/dashboard-scroll-controls`: port the compact controls, corridor-only
   detail selector, and three-second graph hover from `60cba81`, `242ec72`, and
   `00d22d9` without changing the accepted batch transport. Validate, open a
   focused PR, wait for every applicable check, and merge into the experimental
   integration.
2. Start a separate continuous-timeline topic from that accepted merge. Port
   `ab8fac2` and `71b57e8`, retaining bounded buffers and the existing renderer.
   Use the accepted shared scheduler instead of the prototype request counter.
   Prioritize snapshots, visible missing history, then speculative prefetch.
   Cancel obsolete queued work; retain the initial four-second spacing and
   three-interval look-ahead. Validate, review scope, and merge only after all
   applicable checks pass.

## Current checkpoint

Controls were accepted in PR #182 at
`e12a247662489acec9895681c789df7600aba8bf`. The checked head was
`beb259d05c8afca136d91ec283bb7f8c32e3eab3`: two focused commits, ten files
(including shared asset cache keys), all 20 applicable checks successful.
No main merge or deployment occurred.

Continuous history was integrated on
`feature/dashboard-continuous-history` in
`/private/tmp/ctt-continuous-integration`, based on that accepted merge.
The original renderer/cache hunks are ported, and the independent request counter
is removed. Shared batch requests now have snapshot / visible / speculative
priority, with queued obsolete history cancellable without consuming a request.
Continuous PR #183 was accepted at
`6ff14815f30016e79357356dcb605daf55e7670f`. Its checked head was
`73b9c18442cfcb88df6ae50a42ef9da5a291e984`: three coherent commits, twelve
files, and all 20 applicable checks successful. CI run `37737110426`, CodeQL
run `37737106996` (all four actual Analyze jobs), the aggregate CodeQL result,
and GitGuardian passed. No rules bypass or main merge was used.

All 272 dashboard regressions pass and
full Maven verification passed all modules and coverage gates. Native local
checks covered a real armed wheel gesture, every supported timeframe, I-70
speed zones, light/dark rendering, and 390/1093px responsive controls with zero
document overflow. No rendering console errors were observed. These are bounded
functional checks, not universal frame-rate or CPU/thermal guarantees.
The native partial-failure check also confirmed a visible Retry action, retained
healthy data, and no rendering errors. Application/test assets at the accepted
merge are identical to the checked head and the local preview source tree.

## Completed delivery checkpoint

Both planned functional topics are accepted in the experimental integration.
The source prototype is still preserved unchanged; no data or provider settings
were altered. Main remains at `8e48accb2552e1c9aaf4da545b1c901b7ea55606`.
No VPS change or deployment was made by this task.

The owned preview at
`http://127.0.0.1:8091/dashboard/?fixture=live&continuous=1` serves the accepted
application assets from `/private/tmp/ctt-continuous-integration` using synthetic
batch responses, not live traffic. Ports 8092/8093 used for bounded checks were
stopped. User port 8080 was left untouched. The working preview branch contains
only the three accepted continuous-topic commits; use the latest accepted
experimental head as the base of any next topic.

This documentation-only checkpoint is maintained separately on
`docs/historical-integration-checkpoint` in
`/private/tmp/ctt-historical-integration-record`. The next operational step, if
requested, is an exact-revision sidecar rollout following the existing runbook;
it is not implicit in either functional merge.

## Continuous contract and limits

The renderer remains opt-in with `continuous=1`; ordinary historical navigation
is unchanged without that flag. It retains fractional frame movement, original
canvas resolution, fixed speed axes, and a two-window raster reused during
panning. There is no idle animation loop. Oversized canvases use a full-resolution
direct-render fallback rather than allocating an unbounded raster.

Buffers retain up to twelve active intervals, twenty-four total across up to
three recent corridor/view/timeframe configurations, with a 60,000-record soft
target. Visible intervals are protected even if one response exceeds that target.
Evicted speculative intervals are not repeatedly fetched; genuinely visible
missing intervals can reload. Three older intervals and an adjacent newer
interval are prepared at four-second spacing between actual batch dispatches.

Both corridors coalesce into one history batch. The accepted shared scheduler
retains its 48 requests/minute cap and two slots reserved from history. Snapshots
precede visible missing history, which precedes speculative history. Obsolete
queued prefetch is cancelled or replaced at visible priority without consuming
a request slot. Already-dispatched batches finish under the existing 15-second
deadline; they are not preempted simply for priority changes. Scope changes,
Current, disabling, or hiding/departing the page still cancel owned work.
Queued budget waits resume automatically; failed intervals require explicit
Retry, and actual HTTP Retry-After applies to the shared queue.

Observation rows stay in the chart buffer, not duplicated in the version-hint
store. Version hints are taken at dispatch, not before a budget wait, so evicted
payloads cannot suppress the data needed when a queued read resumes.
Interval-specific weekly baselines also drive the reference-band legend.
Changed road boundaries or posted limits remain separate stable zone rows with
matching baseline definitions, never fabricated continuity. Missing observations
stay blank; capped incident annotations retain their limit notice. A newly
encountered zone can add a row; cached rows do not disappear while browsing.

The server's existing 120/IP request limit and API resolutions are unchanged.
The client budget is per page, not coordinated across tabs or users. Request
reduction does not remove database work or guarantee instant uncached reads.

Fixture curves use absolute timestamps so overlapping windows do not invent
phase shifts. An existing demo travel-time regression is pinned to its sample
date instead of depending on the wall-clock day. No application clock changed.

Rollback: revert only the continuous topic to keep accepted compact controls and
shared batches, or omit `continuous=1` to use the accepted discrete navigation.
VPS rollout remains a separately authorized, exact-revision release.
Controls validation: all 249 dashboard regressions and the full Maven verify
passed, including every module's coverage gate. Bounded local browser inspection
confirmed collapsed default details, toggle expansion, and the corridor-only
selector on the accepted batch transport. No provider requests were made.
The existing 48rem responsive breakpoint is retained: primary controls wrap
there, while disabled historical details and the All Corridors detail selector
occupy no layout space. Keyboard navigation remains available immediately;
only graph wheel capture requires uninterrupted three-second dwell.

Validation and accepted PR revisions will be recorded at each delivery point.
