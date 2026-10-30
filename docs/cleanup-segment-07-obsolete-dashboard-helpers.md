# Cleanup segment 7 Remove obsolete dashboard chart helpers

Tracking and final review evidence: [cleanup issue 267](https://github.com/brentjColoS/ColoradoTrafficTracker/issues/267).

## Scope and delivery

- Topic: `refactor/remove-obsolete-dashboard-helpers`.
- Accepted parent: `3357c0cac4d98d99e07337f98ef2a8d1e21bbada`.
- Destination: `experiment/dashboard-reconstruction`; independent of earlier unmerged cleanup topics.
- Local validation complete. The issue records the PR, exact checked head,
  and final CI result after this checkpoint. No merge or deployment performed.
- Consolidate this temporary record after its topic is accepted.

## Change

Remove four dashboard functions with no runtime callers: selectDisplaySamples, buildRollingBaselines, formatRelativeTime, and formatInteger. Retire three tests dedicated solely to obsolete helpers and route the seven-day current-series test through buildCurrentSpeedSeries, the live chart builder.

Unused historical chart implementations obscure the active rendering path. Runtime JavaScript, HTML, and CSS were searched before removal. The active weighted baseline, archived-data fallback, current-series clipping, freshness displays, and number formatting remain in place.

No visible UI, request, cache-key, Java, migration, or runtime configuration changes. Rollback: revert this topic.

## Validation

- All 523 original dashboard tests passed before edits; all 520 retained tests passed afterward.
- The seven-day chart test now exercises the production current-series builder instead of an unused helper.
- Full ./mvnw -B -ntp -s .mvn/public-repositories.xml clean verify passed: 531 tests reported, six existing opt-in skips, coverage gates met.

Next candidate: remove unreachable private flow-poller helpers while preserving active projection and aggregation math.
