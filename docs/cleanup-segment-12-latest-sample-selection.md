# Cleanup segment 12 Share latest traffic sample selection

Tracking and final review evidence: [cleanup issue 267](https://github.com/brentjColoS/ColoradoTrafficTracker/issues/267).

## Scope and delivery

- Topic: `refactor/share-latest-sample-selection`.
- Accepted parent: `3357c0cac4d98d99e07337f98ef2a8d1e21bbada`.
- Destination: `experiment/dashboard-reconstruction`; independent of earlier unmerged cleanup topics.
- Local validation complete. The issue records the PR, exact checked head,
  and final CI result after this checkpoint. No merge or deployment performed.
- Consolidate this temporary record after its topic is accepted.

## Change

Consolidate four latest-sample lookups into LatestTrafficSamples. Latest API, dashboard summary, current summary, and map corridors share usable-first selection and the existing raw fallback.

Repeated lookup branches make selection policy and query costs easy to change inconsistently. Usable results avoid an unnecessary raw read; raw-only requests never query usable rows; absent observations remain unavailable. The map's defensive handling of a null usable-list result is retained in the shared reader.

No repository query, ordering, API schema, source freshness rule, migration, provider, or runtime configuration changes. Null usable-list results now fall back consistently across consumers. Rollback: revert this topic.

## Validation

- Existing tests for all four consumer paths passed before and after consolidation.
- Four new tests verify usable-first selection, raw fallback, raw-only query cost, and unavailable rows including a null usable-list result.
- Full ./mvnw -B -ntp -s .mvn/public-repositories.xml clean verify passed: 535 tests reported, six existing opt-in skips, coverage gates met.

Next candidate: isolate the dashboard's stagnation assessment without changing operational thresholds or notes.
