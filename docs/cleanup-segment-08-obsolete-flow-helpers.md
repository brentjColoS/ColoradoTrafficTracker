# Cleanup segment 8 Remove unreachable legacy flow helpers

Tracking and final review evidence: [cleanup issue 267](https://github.com/brentjColoS/ColoradoTrafficTracker/issues/267).

## Scope and delivery

- Topic: `refactor/remove-obsolete-flow-helpers`.
- Accepted parent: `3357c0cac4d98d99e07337f98ef2a8d1e21bbada`.
- Destination: `experiment/dashboard-reconstruction`; independent of earlier unmerged cleanup topics.
- Local validation complete. The issue records the PR, exact checked head,
  and final CI result after this checkpoint. No merge or deployment performed.
- Consolidate this temporary record after its topic is accepted.

## Change

Remove nearestSpeedForSample, samplePerMile, and avg from TileTrafficPoller: 45 lines of private methods with no production callers. Remove the obsolete sampler reflection test and only the unused-average assertions from the combined average/minimum test.

Legacy implementations remain beside the active sampling, projection, and weighted aggregation paths despite being unreachable. Repository searches established the caller boundary before removal. Active cumulative-distance interpolation and minimum-value coverage are retained.

Primary-service source edits are confined to this isolated experimental branch. No provider requests, ingestion schedule, quota, storage, migration, or running-service changes. Rollback: revert this topic.

## Validation

- Focused TileTrafficPollerMathTest and TrafficPollerHelpersTest passed before and after removal.
- Full ./mvnw -B -ntp -s .mvn/public-repositories.xml clean verify passed: 530 tests reported, six existing opt-in skips, coverage gates met.
- The one-test reduction removes only the unused sampler test; minimum aggregation assertions still pass.

Next candidate: share dashboard window definitions while preserving strict validation and refresh policies.
