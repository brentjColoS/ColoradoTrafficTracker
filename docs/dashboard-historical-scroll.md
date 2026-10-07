# Historical graph-scroll experiment

This is a separate experiment after the verified reconstructed baseline at
`654fb1b`. Its API prerequisite is #177; the interaction uses
`experiment/dashboard-historical-scroll` and returns only to
`experiment/dashboard-reconstruction`. It does not promote UI to production or
silently change the released baseline. Draft #116 remains preserved, not merged.

## Interaction contract

Historical Scroll starts disabled on every page load. Enabling it unlocks wheel
navigation over a graph: down moves earlier, up moves later. Horizontal trackpad
input, arrow keys, Home/First and End/Current offer the same bounded navigation.
Ctrl/Meta/Alt gestures and page scrolling at either boundary remain
available. Disabling locks the chosen graph window; Current still exits history.

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
