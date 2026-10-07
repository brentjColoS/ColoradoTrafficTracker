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

## Current combined flow

The current-flow topic uses the existing bounded current snapshot, or the UTC
hourly bucket at the retained replay anchor. Optional flow failure leaves
charts and incidents usable with no fabricated map condition. Combined half-mile
storage cells are length-weighted into one-mile display intervals; sparse
directional companion rows do not color or replace the combined route.

Calibrated route anchors place each interval. The continuous color scale uses
observed speed divided by the local posted-speed value, not a zone average or
historical clear-running estimate. Labels distinguish above expected, expected,
slowing, heavy, severe and stopped. Full-road closure evidence or speeds at or
below3mph show stopped; one-side evidence remains disclosed without pretending
the whole road is closed. Partial coverage and shared source-span length remain
available in each safe text-only popup with timestamp and comparison basis.

The map module follows coherent source `b36f852`, which intentionally retires
the earlier sparse split-line presentation. It makes no directional geometry
request. Current geometry/flow production foundations are unchanged. The
preceding neutral panel passed CI in #136, accepted at `400e57f`.
One reviewed correction prefers the actual hourly observation time over the
later bucket boundary in the map's Updated label; a focused regression covers it.

## Recurring slowdown history

Seven- and thirty-day views use only bounded 168/720-hour queries of the retained
combined hourly map cells. The read-only endpoint compares hourly average speed
with the current shared posted-speed definitions, classifies below 80%, 60% and
35%, and separately counts near-stops at 3mph or less. No database means 503;
unsupported windows mean 400 and no cells means 404. No schema or collection
change is needed.

The long-range map uses length-weighted slowdown frequency across one-mile
intervals, not a current-speed color or a reconstructed zone mean. Black requires
near-stops in at least 10% of sampled hours. Safe popups disclose sampled-hour
coverage, comparison basis and observed date range. Missing history preserves
neutral geometry, charts and tables without inventing slowdown evidence.
The active current/frequency legend alone is visible, including narrow layouts.

Sources `2f24aaa`, `8d66fcb`, `2243c32` and `ff07e99` own this behavior. The exact
four-line hidden-legend rule from `afc92f4` is recovered here after native testing
exposed flex overriding the hidden attribute; its unrelated incident-row layout
remains in topic24. The reviewed actual-observation timestamp correction from
topic20 is retained. Current flow #137 passed, accepted at `01b7193`.

## Incident timelines

Incident reads now match the selected time window, capped at thirty days and
1,000 reports, preserving retained/replay anchors. At six hours or less the
collapsed table shows ongoing reports, with an explicit expansion message when
only ended reports remain. Expansion keeps all loaded, deduplicated reports.

Short maps retain individual valid selected-corridor reports. Seven/thirty-day
maps instead group distinct provider/event identities into one-mile bands, rank
by event count, active count and latest sighting, and display at most five
calibrated hotspots. Safe popups describe the sampled window and report counts;
the full table remains available. Source `5cf24a3` owns this topic. The original
`ee4addc` top-level zoom interpolation correction is recovered with it so the
hotspot style is renderer-compatible; unrelated lifecycle work stays separate.
Single-report popups correctly say “1 incident”, with a regression test.

Native hotspot clicks also open the underlying traffic popup in the original
intermediate implementation. Topic24 must recover popup prioritization and
single-popup cleanup before release, alongside the known raster-status race.
Slowdown history #138 passed all gates, accepted at `40f74d7`.

## Remaining context and lifecycle topics

Landmark/optional basemap context and
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
