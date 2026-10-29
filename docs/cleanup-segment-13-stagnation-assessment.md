# Cleanup segment 13 Isolate dashboard stagnation assessment

Tracking and final review evidence: [cleanup issue 267](https://github.com/brentjColoS/ColoradoTrafficTracker/issues/267).

## Scope and delivery

- Topic: `refactor/isolate-traffic-stagnation-assessment`.
- Accepted parent: `3357c0cac4d98d99e07337f98ef2a8d1e21bbada`.
- Destination: `experiment/dashboard-reconstruction`; independent of earlier unmerged cleanup topics.
- Local validation complete. The issue records the PR, exact checked head,
  and final CI result after this checkpoint. No merge or deployment performed.
- Consolidate this temporary record after its topic is accepted.

## Change

Move stagnation lookbacks, queries, repeated-flow calculations, operating-mode thresholds, assessment DTO construction, and explanatory notes into TrafficStagnation. Reduce TrafficDashboardController from 827 to 319 lines.

Stagnation assessment is a distinct responsibility from HTTP validation, provider status, latest samples, and corridor summaries. Existing thresholds, event windows, Denver operating schedules, minimum-sample requirements, severity decisions, and notes move unchanged. The controller reuses its existing repositories through a plain helper; no additional Spring bean or query is introduced.

No warning policy, source freshness, request cadence, API field, repository query, provider, migration, or runtime configuration changes. The new helper remains in the existing mutation scope. Rollback: revert this topic.

## Validation

- Existing dashboard controller and logic tests passed before and after extraction.
- Moved calculation bodies, constants, records, and enums were compared with the accepted parent, allowing only ownership and record-name changes.
- Full ./mvnw -B -ntp -s .mvn/public-repositories.xml clean verify passed: 531 tests reported, six existing opt-in skips, coverage gates met.

Next candidate: factor repeated incident reference SQL while comparing compiled query contracts.
