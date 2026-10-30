# Cleanup segment 3 Geometry serialization

Tracking and final review evidence: [cleanup issue 267](https://github.com/brentjColoS/ColoradoTrafficTracker/issues/267).

## Scope and delivery

- Topic: `refactor/serialize-corridor-geometry`.
- Accepted parent: `3357c0cac4d98d99e07337f98ef2a8d1e21bbada`.
- Destination: `experiment/dashboard-reconstruction`; independent of the earlier
  unmerged cleanup PRs. No merge, production promotion, or deployment authority.
- Local implementation and validation complete. The issue records the PR,
  exact checked head, and final CI outcome after this repository checkpoint.
- Preserve this temporary entry until the cleanup logs can be consolidated.

## Change

Replace index-based comma assembly with a list of formatted coordinates and a
join. Invalid entries no longer leave a leading comma. Fewer than two usable
points return null, allowing the existing store guard to preserve saved geometry
instead of replacing it with an empty or single-point LineString.

Longitude/latitude order, six decimal places, US decimal formatting, rounding,
and valid-line output remain unchanged. The redundant single-number formatter
is removed. No provider calls, migrations, stored-data edits, or runtime changes
were performed; this is an ingestion helper change confined to the experimental
topic. Revert the topic to roll back.

## Validation

- Original three geometry tests passed before edits.
- New tests reproduced the leading comma and empty-LineString defects before
  the fix; both failed for the expected output mismatch.
- All six geometry tests passed after the fix, including skipped entries,
  minimum usable length, coordinate order, rounding, and existing fallback.
- Full `./mvnw -B -ntp -s .mvn/public-repositories.xml clean verify` passed:
  534 tests reported, six existing opt-in skips, coverage gates met.

Next independent topic: keep the original road-sign SVGs outside API static
resources while preserving the runtime PNGs and authoritative artwork bytes.
