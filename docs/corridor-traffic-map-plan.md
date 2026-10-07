# Corridor map reconstruction

The map topics return to `experiment/dashboard-reconstruction`, never `main`.
Read [the recovery ledger](dashboard-recovery.md) and
[experimental delivery workflow](experimental-delivery-workflow.md) first.
No partially reconstructed map is a release candidate.

## Focused neutral panel

Selecting I-25 or I-70 replaces the other corridor's hidden incident table with
the selected corridor's map. All Corridors keeps both tables and hides the map.
The focused layout stacks below 64rem; the map legend wraps without obscuring
the bottom-right attribution. The complete incident table remains available.

The initial panel reads the existing corridor GeoJSON already fetched by the
dashboard. It fits the monitored route outline, not a guessed road shape, and
shows only selected-corridor CDOT points with valid coordinates that are not
explicitly off-corridor. Popups use text nodes for provider content and label
the report's type, location, state and available direction/mile marker.
The server remains responsible for tracked-mile filtering.

The neutral outline shows no traffic condition. Missing geometry, unavailable
imagery or failed renderer/WebGL startup must retain the table and explain the
limitation. Native renderer loading, worker loading, themes and responsive
behavior require actual browser verification before accepting this topic.

The reconstructed failed-raster fixture retains vector context but can overwrite
its failure message during startup. This is a known partial-reconstruction
limitation assigned to lifecycle topic24, which must fix and recheck it before
the complete candidate can be released.

## Sources and guardrails

The pinned self-hosted [renderer](maplibre-renderer.md) loads relative to the
module so both public dashboard mounts work. USGS Imagery Only is a geographic
backdrop, not live satellite traffic. Preserve USGS and OSM attribution, request
only visible tiles, honor cache headers and retain a neutral basemap fallback.
The [imagery record](corridor-map-imagery.md) preserves dated September 20
source evidence; that evidence is not validation of this reconstructed build.

No browser requests TomTom tiles or receives provider credentials. No new
provider calls, ingestion cadence, schema, retention or historical data changes
are part of these UI topics. Existing production flow/geometry foundations are
already present and are not replayed. Half-mile storage intervals do not imply
independent half-mile measurements; later traffic layers must retain source
quality, gaps and shared-source context rather than infer colors from zone means.

## Remaining topics

Current combined flow, bounded slowdown history and incident timelines are
separate PRs after this neutral panel. Landmark/optional basemap context and
renderer lifecycle/retry/readiness are separate topics too. Use the actual
existing API payloads and retain explicit unavailable states. The final visual
reference uses complete combined-direction coverage rather than sparse split
lines; conservative backend direction evidence remains intact.

Final I-70 UI bounds and speed zones align with current production before any
release. The complete candidate requires source accounting, CI, browser review
and bounded performance assessment, then exact-SHA sidecar-only deployment.
Neither old promotion claims nor old test results authorize production changes.

## Historical provenance

This topic recovers `dd7e8f7` (map slot), `7903313` (neutral renderer integration),
`6394453` (attribution clearance), and the relative import from `c6a8704`.
Sources `f8efdee` and `59b182e` record the neutral milestone and imagery proof.
The original long plan remains in preserved Git history; this current record
replaces obsolete branch destinations, pending production-foundation assertions
and historical readiness claims instead of treating them as new verification.
