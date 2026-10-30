# Cleanup segment 15 Share analytics trend projection columns

Tracking and final review evidence: [cleanup issue 267](https://github.com/brentjColoS/ColoradoTrafficTracker/issues/267).

## Scope and delivery

- Topic: `refactor/share-analytics-trend-projection`.
- Accepted parent: `3357c0cac4d98d99e07337f98ef2a8d1e21bbada`.
- Destination: `experiment/dashboard-reconstruction`; independent of earlier unmerged cleanup topics.
- Local validation complete. The issue records the PR, exact checked head,
  and final CI result after this checkpoint. No merge or deployment performed.
- Consolidate this temporary record after its topic is accepted.

## Change

Factor five identical analytics trend SELECT lists into one TREND_PROJECTION SQL constant. Remove 49 net source lines while retaining every projection alias, speed metric, incident total, and archived-sample count.

Repeated column lists can drift across trend query variants. Only the identical trend projections are shared; weighted summary projections remain separate. Source tables, time boundaries, usability filters, ordering, limits, and parameter bindings remain unchanged.

No database, view, migration, public response, runtime configuration, or provider changes. No live database was queried; compiled-query equivalence supplies the SQL preservation evidence. Rollback: revert this topic.

## Validation

- Focused analytics and dashboard controller tests passed before and after extraction.
- All eleven compiled query annotations were captured before and after: SQL tokens, quoted literals, method signatures, native-query flags, and all other annotation metadata match.
- Full ./mvnw -B -ntp -s .mvn/public-repositories.xml clean verify passed: 531 tests reported, six existing opt-in skips, coverage gates met.
- git diff --check passed; only the repository source and temporary checkpoint are in scope.

Next candidate: validate the cleanup topics together in a temporary checkout, then assess the next dashboard boundary separately.
