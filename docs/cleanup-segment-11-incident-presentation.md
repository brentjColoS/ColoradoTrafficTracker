# Cleanup segment 11 Isolate map incident presentation rules

Tracking and final review evidence: [cleanup issue 267](https://github.com/brentjColoS/ColoradoTrafficTracker/issues/267).

## Scope and delivery

- Topic: `refactor/isolate-map-incident-presentation`.
- Accepted parent: `3357c0cac4d98d99e07337f98ef2a8d1e21bbada`.
- Destination: `experiment/dashboard-reconstruction`; independent of earlier unmerged cleanup topics.
- Local validation complete. The issue records the PR, exact checked head,
  and final CI result after this checkpoint. No merge or deployment performed.
- Consolidate this temporary record after its topic is accepted.

## Change

Move incident reference keys, labels, descriptions, impact summaries, and explanatory notes into MapIncidentPresentation. The map controller delegates its eight presentation properties to the focused helper.

Presentation normalization is a separate responsibility from endpoint validation, storage reads, and geometry selection. Existing source-type precedence, CDOT text handling, legacy icon labels, duplicate impact removal, and note filtering move without algorithm changes.

No API property, text policy, geometry, cache key, provider, migration, or runtime configuration changes. The helper remains in existing mutation scope. Rollback: revert this topic.

## Validation

- All 21 original map endpoint tests passed before and after extraction.
- Moved presentation method bodies were compared with the accepted parent, allowing only visibility changes needed by the controller.
- Full ./mvnw -B -ntp -s .mvn/public-repositories.xml clean verify passed: 531 tests reported, six existing opt-in skips, coverage gates met.

Next candidate: share latest-sample selection while protecting query ordering and usable-flow fallback.
