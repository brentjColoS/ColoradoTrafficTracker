# Cleanup segment 2 Map posted speed zones

Tracking issue: [Incremental repository cleanup](https://github.com/brentjColoS/ColoradoTrafficTracker/issues/267).

## Scope and delivery

- Branch: `refactor/reuse-map-speed-zones`.
- Parent: `3357c0cac4d98d99e07337f98ef2a8d1e21bbada` on
  `experiment/dashboard-reconstruction`.
- Segment 1 remains in [PR 268](https://github.com/brentjColoS/ColoradoTrafficTracker/pull/268),
  awaiting review. This topic starts from the accepted integration without its changes.
- Status: implementation and local validation complete; PR checks and review pending.
- Code revision: `4a798806223ea646189955f61180791804ebb8f1`.
- Review: [PR 269](https://github.com/brentjColoS/ColoradoTrafficTracker/pull/269).
  Check results belong to its exact review head; consult the PR before accepting
  or resuming this topic. Integration and deployment require separate authority.
- Delivery: no merge or deployment.

This separate entry avoids editing segment 1's unmerged cleanup log. Consolidate
the entries into `docs/cleanup-progress.md` once both segments are accepted.

## Change

The map controller now derives posted-speed segments from `CorridorSpeedZones`,
the existing catalog used by ingestion. Its duplicate eleven-entry catalog,
private segment record, and redundant mile-marker formatter have been removed.
The map response still exposes the original five fields per segment, with the
same order, numbers, descriptions, labels, source, and notes. Internal zone
identities are not added to the public map response.

Shared definitions, ingestion, stored history, request cadence, and directional
variable-sign exceptions are unchanged. No migration or new dependency is needed.

## Validation

The original controller output was captured with mocked repositories before the
refactor. A fixed JSON fixture protects all eleven segments and the source/notes
through both the protected and public API aliases. The fixture does not derive
expected values from the shared implementation.

All 23 focused map tests passed before and after the refactor, including the two
new API contract cases. The full Maven `clean verify` passed: 533 tests reported,
six existing opt-in tests skipped, and coverage gates met. All 523 dashboard
tests passed, including the directional variable-sign exception cases.

Local Maven commands used `-B -ntp -s .mvn/public-repositories.xml`; the focused
run selected `TrafficMapControllerTest,TrafficMapSpeedLimitContractTest` with
`-pl api-service -am -Dsurefire.failIfNoSpecifiedTests=false`. The frontend gate
was `node --test scripts/tests/dashboard.test.cjs`.

Suggested next segment: simplify the existing ingestion GeoJSON serializer,
preserving coordinate formatting while fixing skipped-point comma handling.
