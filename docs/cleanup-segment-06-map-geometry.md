# Cleanup segment 6 Isolate map incident geometry calculations

Tracking and final review evidence: [cleanup issue 267](https://github.com/brentjColoS/ColoradoTrafficTracker/issues/267).

## Scope and delivery

- Topic: `refactor/isolate-map-incident-geometry`.
- Accepted parent: `3357c0cac4d98d99e07337f98ef2a8d1e21bbada`.
- Destination: `experiment/dashboard-reconstruction`; independent of earlier unmerged cleanup topics.
- Local validation complete. The issue records the PR, exact checked head,
  and final CI result after this checkpoint. No merge or deployment performed.
- Consolidate this temporary record after its topic is accepted.

## Change

Move incident projection, source-marker interpolation, geometry parsing, and fallback selection into MapIncidentGeometry. Reduce TrafficMapController from 762 to 542 lines while retaining its endpoint orchestration and response properties.

Geometry calculations are a separate responsibility from queries and HTTP responses. The existing algorithms and records move without changes to rounding, snap selection, malformed-geometry handling, or provider fallback order. No new Spring bean or dependency is introduced; the existing ObjectMapper is reused.

No API, cache key, request cadence, migration, provider, or runtime configuration changes. Rollback: revert this topic.

## Validation

- All 21 original map endpoint tests passed before extraction and within final verification.
- Full ./mvnw -B -ntp -s .mvn/public-repositories.xml clean verify passed: 531 tests reported, six existing opt-in skips, coverage gates met.
- Moved method bodies were compared with the accepted parent; the new helper remains in the existing API-support mutation scope.

Next candidate: remove obsolete dashboard helpers after checking runtime and test-only references.
