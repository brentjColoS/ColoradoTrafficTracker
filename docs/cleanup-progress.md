# Experimental cleanup progress

This temporary log records completed cleanup segments and the evidence needed to
resume them. Keep it through the cleanup effort, then fold lasting decisions into
the relevant runbooks and remove this working log.

## Working boundaries

Tracking issue: [Incremental repository cleanup](https://github.com/brentjColoS/ColoradoTrafficTracker/issues/267).

Cleanup topics target `experiment/dashboard-reconstruction`. Each segment uses an
isolated branch, preserves features and availability, and receives focused tests
before broader validation. A reviewed cleanup PR does not authorize a merge,
production promotion, or deployment. Preserve the experimental CI marker,
historical data, applied migrations, provider budgets, and accepted presentation.

## Current checkpoint and next batch

The next bounded batch is recorded in [segments 31–45](cleanup-batch-31-45.md).
Its delivery state is maintained in issue 267; do not treat pending source notes
as evidence of a merge or release.

Segments 1–15 were accepted and released to the experimental sidecar at
`9227ea8cfaf7b969a3e866bc0fe0fe0ea289d9c0`. Earlier delivery statuses below are
historical; issue 267 records current heads, checks, merges, and recovery tags.
Review and verify the combined work before exceeding another fifteen segments.
Prefer actual removal and deduplication; report runtime reductions separately
from extraction, tests, and these notes. Preserve all features.

## Segment 16 Remove obsolete presentation styles

- Branch: `refactor/remove-obsolete-dashboard-styles`; parent: `9227ea8`.
- Remove fifteen unreachable CSS rules and unused selector branches from old
  information layouts, diagram arrows, and legend decoration: 80 net runtime
  lines / 1,428 bytes removed. No replacement code or helper files.
- Runtime HTML/JavaScript and dynamic class generators were reviewed. Active
  incident-tone and MapLibre-generated selectors remain intact.
- All 527 dashboard tests passed before and after; Maven clean verify passed
  with 542 reported, six existing opt-in skips, zero failures/errors.
- Sixteen static rendering comparisons (four pages, two themes, 390/1440px)
  found no computed-style differences; animations were frozen for comparison.
- PR/check/delivery state is recorded in issue 267. No service or data changes.
- Next candidate: repeated incident projection SQL, with compiled-query parity.

## Segment 1 Shared speed zone travel estimates

- Branch: `refactor/share-speed-zone-estimates`.
- Parent: `3357c0cac4d98d99e07337f98ef2a8d1e21bbada` on the experimental integration.
- Code revision: `41ad7d018aa031301b4b0176926305e97e62b010`.
- Review: [PR 268](https://github.com/brentjColoS/ColoradoTrafficTracker/pull/268)
  targets `experiment/dashboard-reconstruction`; its
  [checks](https://github.com/brentjColoS/ColoradoTrafficTracker/pull/268/checks)
  identify the current review head and CI results. Recheck them before integration.
- Status: implementation and local validation complete; PR review pending.
- Delivery: no merge or deployment.

The dashboard and Data page now delegate speed-zone travel calculations to the
existing `TrafficEstimates` module. One implementation owns distance over speed,
deduplication, contiguous coverage, and the existing 0.02-mile tolerance. Each
page keeps its established numeric parsing rules, including their different
handling of booleans and whitespace. Current flow-cell and server-side historical
calculations remain separate.

The Data page loads estimates before initialization. Changed script references
use `shared-zone-estimates-1` consistently; other information pages do not need
the shared module. Styling, requests, refresh cadence, and data storage are
unchanged.

Validation checkpoints:

- Before extraction: all 523 experimental dashboard tests passed.
- Before extraction: a characterization test confirmed the existing page-specific
  numeric input behavior.
- After extraction: five standalone calculation tests and focused page tests
  passed, covering duplicate/reversed zones, gaps, overlaps, missing values,
  stopped traffic, tolerance, input immutability, and initialization dependencies.
- All 530 dashboard tests passed. A seeded probe matched the original page
  implementations in 20,000 comparisons.
- Maven `clean verify` and final `verify` passed: 531 Java tests, six existing
  opt-in skips, no failures or errors. Local JDK 24 targeted Java 21.
- All seven changed runtime resources matched the packaged application.

Suggested next segment: derive map posted-speed segments from the existing shared
definitions while preserving the public response and directional sign exceptions.
Inspect the then-current accepted integration before starting it.
