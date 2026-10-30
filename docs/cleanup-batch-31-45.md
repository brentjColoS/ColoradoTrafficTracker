# Cleanup batch 31–45

Accepted parent and current running experimental checkpoint: `8d52338e6dd686cba97789ac8597cfca2b2e37d8`.
Integration destination: `experiment/dashboard-reconstruction`. Production and
`main` remain outside this batch. [Recovery ledger](https://github.com/brentjColoS/ColoradoTrafficTracker/issues/267)
records current exact heads, checks, accepted merges and release state; recheck it
and actual Git/runtime state before continuing. These notes are excluded from
cleanup reduction counts.

| Segment | Scope | Review |
| --- | --- | --- |
| 31 | Share dashboard Retry-After parsing | [#298](https://github.com/brentjColoS/ColoradoTrafficTracker/pull/298) |
| 32 | Share strict tracked corridor validation | [#299](https://github.com/brentjColoS/ColoradoTrafficTracker/pull/299) |
| 33 | Remove the unused speed-zone sample lookup | [#300](https://github.com/brentjColoS/ColoradoTrafficTracker/pull/300) |
| 34 | Use the standard hexadecimal API key fingerprint | [#301](https://github.com/brentjColoS/ColoradoTrafficTracker/pull/301) |
| 35 | Share corridor analytics summary mapping | [#305](https://github.com/brentjColoS/ColoradoTrafficTracker/pull/305) |
| 36 | Reuse the tracked incident location predicate | [#302](https://github.com/brentjColoS/ColoradoTrafficTracker/pull/302) |
| 37 | Reuse the dashboard range catalog | [#303](https://github.com/brentjColoS/ColoradoTrafficTracker/pull/303) |
| 38 | Share repeated information page style rules | [#306](https://github.com/brentjColoS/ColoradoTrafficTracker/pull/306) |
| 39 | Share identical dashboard legend styles | [#304](https://github.com/brentjColoS/ColoradoTrafficTracker/pull/304) |
| 40 | Share information page SVG symbols | [#307](https://github.com/brentjColoS/ColoradoTrafficTracker/pull/307) |
| 41 | Separate dashboard snapshot assembly | [#309](https://github.com/brentjColoS/ColoradoTrafficTracker/pull/309) |
| 42 | Separate dashboard request coordination | [#310](https://github.com/brentjColoS/ColoradoTrafficTracker/pull/310) |
| 43 | Name dashboard route read results | [#311](https://github.com/brentjColoS/ColoradoTrafficTracker/pull/311) |
| 44 | Audit helper contracts; retain numeric/date/theme differences | Assessment only |
| 45 | Remove duplicate stagnation operating modes | [#308](https://github.com/brentjColoS/ColoradoTrafficTracker/pull/308) |

All fourteen implementation topics passed their local applicable gates: full
Maven clean verify for Java changes and the full dashboard suite. The unchanged
baseline passed 527 dashboard tests; segment 31 adds one Retry-After boundary
case. Segment 43 also matches 195 baseline route request/result fixtures across
all ranges, live/historical/replay modes and partial-source failures.

Segments 41 and 42 move cohesive code without claiming moved lines as removals.
Segment 44 deliberately leaves similar helpers separate: their coercion, locale,
storage and device-theme contracts differ. Segment 40 preserves different SVG
artwork under distinct IDs and versions its changed theme script.

Combined SQL/behavior, visual, mutation, packaging and isolated-runtime checks
remain pending at this source revision. Merge only checked heads after that
review, then repeat verification on the exact merged checkpoint and release only
the experimental sidecar. Keep the prior image and Git checkpoint for rollback.
The recovery ledger supersedes this historical delivery status once acceptance
and release complete.
