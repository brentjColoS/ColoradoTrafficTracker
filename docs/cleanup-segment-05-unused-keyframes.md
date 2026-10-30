# Cleanup segment 5 Unused information-page animations

Tracking and final review evidence: [cleanup issue 267](https://github.com/brentjColoS/ColoradoTrafficTracker/issues/267).

## Scope and delivery

- Topic: `refactor/remove-unused-dashboard-keyframes`.
- Accepted parent: `3357c0cac4d98d99e07337f98ef2a8d1e21bbada`.
- Destination: `experiment/dashboard-reconstruction`, independent of the other
  unmerged cleanup topics. No merge, promotion, or deployment performed.
- Local validation complete. The issue records the PR, exact reviewed head,
  and final CI result after this checkpoint. Consolidate temporary entries once
  their topics are accepted.

## Change

Remove the unused `system-source-underline`, `system-signal-handoff`, and
`system-highlight-draw` keyframe definitions from `information.css`: 59 lines and
1,230 bytes. Runtime CSS, HTML, and JavaScript contain no references to these
names outside their definitions. The audit included animation-event handlers
and programmatic animation inspection, rather than CSS declarations alone.

All selectors, declarations outside those three blocks, live animations, and
reduced-motion rules remain byte-identical. No page scripts, HTML, cache keys,
dependencies, configuration, provider requests, or stored data change. Revert
the topic to restore the definitions.

## Validation

- A brace-aware definition audit found exactly these three unreferenced names.
  A repository-wide reference search confirmed no other callers.
- Removing just those blocks from the accepted parent reproduces the edited
  stylesheet exactly; no other CSS was rewritten.
- All 523 tests in `node --test scripts/tests/dashboard.test.cjs` passed.
- Full `./mvnw -B -ntp -s .mvn/public-repositories.xml clean verify` passed:
  531 tests reported, six existing opt-in skips, coverage gates met.
- All 38 packaged dashboard resources were verified: only `information.css`
  differs from the accepted parent, and the JAR contains its edited bytes.

Suggested next assessment: isolate the map controller's geometry-projection
helpers while protecting snapped incident and mile-marker placement behavior.
