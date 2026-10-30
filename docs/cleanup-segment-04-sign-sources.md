# Cleanup segment 4 Sign source packaging

Tracking and final review evidence: [cleanup issue 267](https://github.com/brentjColoS/ColoradoTrafficTracker/issues/267).

## Scope and delivery

- Topic: `refactor/move-sign-artwork-sources`.
- Accepted parent: `3357c0cac4d98d99e07337f98ef2a8d1e21bbada`.
- Destination: `experiment/dashboard-reconstruction`, independent of other
  unmerged cleanup topics. No merge, promotion, or deployment performed.
- Local validation complete. The issue records the PR, exact reviewed head,
  and final check results after this checkpoint. Consolidate temporary entries
  once their topics are accepted.

## Change

Move the two authoritative road-sign SVG exports from API static resources to
`docs/artwork/road-signs` and update their documentation links. Their bytes remain
intact, honoring the artwork preservation constraint in `road-sign-display.md`.
The runtime PNGs, component, URLs, reflection masks, and transitions are unchanged.

This removes 4,169,037 uncompressed authoring bytes from the runtime static bundle;
it does not reduce Git history or the retained source-artwork size. The unused
SVG source URLs cease to be static endpoints. Searches found no runtime callers.
No resource exclusions, dependencies, build configuration, or migrations change.
Rollback is a revert of these moves and documentation edits.

## Validation

- Repository reference search found only source documentation links for the SVGs.
- Both moved files match their accepted-parent bytes exactly (SHA-256 checked).
- The packaged dashboard contains exactly the original 36 other files; every
  file is byte-identical to the accepted parent, including both runtime PNGs.
  Neither source SVG remains in the application JAR.
- Full `./mvnw -B -ntp -s .mvn/public-repositories.xml clean verify` passed:
  531 tests reported, six existing opt-in skips, coverage gates met.
- All 523 tests in `node --test scripts/tests/dashboard.test.cjs` passed.

Next independent topic: remove the three unreferenced information-page keyframe
definitions after confirming that all live animation declarations remain intact.
