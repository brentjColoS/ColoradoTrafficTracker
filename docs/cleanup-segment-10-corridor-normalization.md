# Cleanup segment 10 Share matching corridor normalization rules

Tracking and final review evidence: [cleanup issue 267](https://github.com/brentjColoS/ColoradoTrafficTracker/issues/267).

## Scope and delivery

- Topic: `refactor/share-open-corridor-normalization`.
- Accepted parent: `3357c0cac4d98d99e07337f98ef2a8d1e21bbada`.
- Destination: `experiment/dashboard-reconstruction`; independent of earlier unmerged cleanup topics.
- Local validation complete. The issue records the PR, exact checked head,
  and final CI result after this checkpoint. No merge or deployment performed.
- Consolidate this temporary record after its topic is accepted.

## Change

Share the three byte-identical open-ended corridor normalizers used by map, analytics, and dashboard-summary endpoints. Keep whitespace trimming, Locale.ROOT uppercase, null handling, and acceptance of configured codes unchanged.

A single implementation removes repetition without combining different endpoint policies. Strict I25/I70 validation, hyphen-stripping directional geometry, and the legacy latest/history endpoint normalizer remain separate. Both API aliases retain configured hyphenated codes rather than silently converting them to another corridor.

No accepted-code restriction, cache key, repository query, provider, migration, or runtime configuration changes. Rollback: revert this topic.

## Validation

- Existing map, analytics, and dashboard controller tests passed before and after extraction.
- Two new API-alias characterization cases passed before and after extraction, preserving hyphenated configured codes.
- Full ./mvnw -B -ntp -s .mvn/public-repositories.xml clean verify passed: 533 tests reported, six existing opt-in skips, coverage gates met.

Next candidate: separate incident presentation rules from map HTTP and repository orchestration.
