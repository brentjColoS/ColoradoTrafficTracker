# Cleanup segment 9 Share dashboard range bucket definitions

Tracking and final review evidence: [cleanup issue 267](https://github.com/brentjColoS/ColoradoTrafficTracker/issues/267).

## Scope and delivery

- Topic: `refactor/share-dashboard-range-policy`.
- Accepted parent: `3357c0cac4d98d99e07337f98ef2a8d1e21bbada`.
- Destination: `experiment/dashboard-reconstruction`; independent of earlier unmerged cleanup topics.
- Local validation complete. The issue records the PR, exact checked head,
  and final CI result after this checkpoint. No merge or deployment performed.
- Consolidate this temporary record after its topic is accepted.

## Change

Replace four copies of the dashboard range-to-bucket mapping with one immutable DashboardRanges catalog. Trend queries, retained history blocks, window summaries, and background refresh intervals now share the five accepted range definitions.

Duplicated range tables can drift across current and retained views. Each caller keeps its original unsupported-range policy: trend rejection, history exception, or 180-minute fallback. Selected and 24-hour refresh intervals remain 60 seconds, and other refresh intervals retain their original values.

No API response, query shape, refresh timing, migration, provider, or running-service changes. Rollback: revert this topic.

## Validation

- All focused history-block, window-summary, trend-controller, and data-service tests passed before and after the change.
- A pre-change characterization test confirmed unsupported history ranges reject before any storage call; it still passes after consolidation.
- Full ./mvnw -B -ntp -s .mvn/public-repositories.xml clean verify passed: 532 tests reported, six existing opt-in skips, coverage gates met.

Next candidate: share only the identical open-ended corridor normalization rules; retain endpoint-specific strict rules.
