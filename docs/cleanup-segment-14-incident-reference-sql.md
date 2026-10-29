# Cleanup segment 14 Share historical incident reference SQL

Tracking and final review evidence: [cleanup issue 267](https://github.com/brentjColoS/ColoradoTrafficTracker/issues/267).

## Scope and delivery

- Topic: `refactor/share-incident-reference-sql`.
- Accepted parent: `3357c0cac4d98d99e07337f98ef2a8d1e21bbada`.
- Destination: `experiment/dashboard-reconstruction`; independent of earlier unmerged cleanup topics.
- Local validation complete. The issue records the PR, exact checked head,
  and final CI result after this checkpoint. No merge or deployment performed.
- Consolidate this temporary record after its topic is accepted.

## Change

Factor six identical historical incident identity expressions into one INCIDENT_REFERENCE_KEY SQL constant. Remove 80 net source lines while preserving provider-event identities and fallback corridor, direction, marker, location, and centroid keys.

The same identity rule appeared in distinct selection, ordering, and counts. A shared expression prevents future drift between those query paths. Native query method signatures, parameters, filters, archive-inclusive sources, and ordering remain unchanged; only SQL whitespace may differ after constant concatenation.

No database, view, migration, parameter binding, runtime configuration, or provider changes. No live database was queried; compiled-query equivalence supplies the SQL preservation evidence. Rollback: revert this topic.

## Validation

- Focused traffic controller and regression tests passed before and after the extraction.
- All five compiled query annotations were captured before and after: SQL tokens, quoted literals, method signatures, native-query flags, and all other annotation metadata match.
- Full ./mvnw -B -ntp -s .mvn/public-repositories.xml clean verify passed: 531 tests reported, six existing opt-in skips; final API-module verify and query comparison also passed.
- git diff --check passed after formatting the extracted SQL.

Next candidate: factor repeated analytics trend projection columns using the same compiled-query comparison.
