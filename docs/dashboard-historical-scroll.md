# Historical graph-scroll experiment

Current integration and continuous-timeline limits are recorded in
[`dashboard-continuous-integration.md`](dashboard-continuous-integration.md).
Compact controls and the three-second wheel delay were accepted in PR #182.
The optional `continuous=1` path uses the shared batch scheduler; the discrete
path described below remains the default. Historical validation below describes
its original release, not the latest continuous candidate.

This is a separate experiment after the verified reconstructed baseline at
`654fb1b`. API prerequisite #177 and interaction #178 passed their applicable
gates and merged only into `experiment/dashboard-reconstruction`, at
`4ef28df0d93f0f29b870c4e74765a7933f6234c8`. The interaction's topic branch is
`experiment/dashboard-historical-scroll`. It does not promote UI to production
or silently change the released baseline. Draft #116 remains preserved, not merged.

## Interaction contract

Historical Scroll starts disabled on every page load. Its toggle sits between
the corridor detail selector and time ranges. Navigation details take no layout
space until enabled; the detail selector appears only for a selected corridor.
Enabling starts a three-second graph hover before wheel capture: down moves
earlier, up moves later. Wheel input before readiness scrolls the page and
restarts the delay. Leaving the graph, switching graphs, disabling history,
pointer cancellation, blur, or hiding/leaving the page resets readiness. Motion
within one graph does not restart the delay. Horizontal trackpad
input, arrow keys, Home/First and End/Current offer the same bounded navigation.
Ctrl/Meta/Alt gestures and page scrolling at either boundary remain
available. Disabling locks the chosen graph window and collapses navigation;
re-enable to navigate or select Current. Keyboard navigation has no hover delay.

All five ranges use the same fractional movement. Boundaries come from actual
usable corridor/zone observation timestamps, independently; archives stay
queryable. First shows the earliest full selected window, with the existing
bucket resolution. Missing bounds have a concrete retry path. No historical
coverage-change announcement is added to the product.

Only graphs and their baseline/incident annotations change. Summary cards,
incident tables, health and maps stay in their selected current window. Historical
speeds are labeled observed, not live. A pending window does not borrow another
window's observations or baseline. Data gaps remain gaps. Capped incident markers
explain their 1,000-report limit and suggest a shorter range.

## Bounded work and failure behavior

- Wheel bursts share one animation frame and a 250 ms debounce. Historical read
  batches start no more often than every four seconds, so rapid repeated movement
  can intentionally show a brief pending state rather than multiplying queries.
- Chart responses use eight bounded cache entries; complete responses expire
  after a minute. Partial responses are retryable, not reusable complete entries.
  Weekly Denver baseline reuse is bounded to sixteen entries.
- Existing API ceilings remain: trends at most 890 buckets, short detailed speeds
  at most 2,000 samples and incident timelines at most 1,000 reports/30 days.
  No ingestion, summary, health, geometry or flow-cell reads are caused by panning.
- Superseded requests and Current cancel in-flight chart reads; hidden/departed
  pages cancel reads and timers. Back-forward restoration preserves the chosen
  window and resumes only needed work. Existing 15-second request deadlines apply.
- A failed corridor does not hide the other one. Server Retry-After suppresses
  further historical reads until the deadline; it does not automatically retry a
  failed window. Retry and Current remain explicit recovery paths.
- Canvas resolution and existing visual motion remain unchanged. Denver hour
  parts are memoized with a 4,096-entry bound, and complete baseline profiles avoid
  unused legacy scans. Pending speed-zone reads preserve graph height, preventing
  the pointer and page from jumping as data loads.

## Validation

236 frontend regressions, 33 CI tooling tests, actionlint and diff checks passed.
Java 21 full verification passed all modules and coverage gates in 41.945 seconds.
Owned native-browser checks covered all five overall ranges, real mouse wheel and
keyboard movement, First/Current/locking, I-70 24-hour and I-25 monthly zone views,
both API mounts and light/dark layouts. Page overflow was zero at 320, 390, 1093
and 2560 pixels. The pending I-70 zone graph retained its 1,026-pixel height and
its live map/card state. Partial bounds, partial/complete history failures and
HTTP 429 retained truthful retry/current paths. Native inspection found and
corrected the pending-height jump and the failed-read/empty-history distinction.
No rendering console errors were observed. This is bounded functional assessment,
not a CPU/GPU/thermal or universal-hardware performance guarantee.

#178 checked head `0d6418d8d7461f1e56433f309c240438e6a79b2a` passed CI run
37678649143 (attempt 2), CodeQL run 37678647069 with all four actual Analyze
jobs, the CodeQL result and GitGuardian. A one-commit/11-file/20-check guard
verified the exact head and experimental destination before a normal merge.
Attempt 1 failed only an unchanged routes-service dependency download with
Maven Central HTTP 502; a failed-only retry passed. No source or gate changed.
The existing mutation classifier correctly exempted this frontend-only topic
from JVM PIT execution; application/coverage/container/security gates still ran.

Focused behavior, broader Java/coverage and bounded local native-browser
assessment are recorded in topic 54 of the recovery ledger. The coverage query
was checked once under the existing database reader in a read-only transaction
with a 15-second statement deadline: indexed Limit/Merge Append/Index Scan plans
took 1.301 ms for I-25 and 1.451 ms for I-70. No migration or provider request was
needed. These timings are one query check, not universal performance guarantees.

The owned local fixture is synthetic and provider-free. Public-domain native
browser access remains blocked by the user's saved permission and is not
bypassed. The released baseline's direct asset/data evidence remains separate
from this experiment's local visual evidence.

The owned preview `http://127.0.0.1:8091/dashboard/?fixture=live` is open at normal
browser sizing with Historical Scroll disabled. It serves accepted application
assets with synthetic API fixtures and leaves user port 8080 untouched. A later
scrolling sidecar rollout requires a separate exact-SHA release and verification;
this local experiment has not been silently deployed.
