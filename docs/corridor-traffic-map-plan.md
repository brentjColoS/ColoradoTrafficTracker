# Corridor traffic map plan

Started September 20, 2026. The current dashboard experiment is preserved at
`79fc2c6` on `experiment/dashboard-development` and
`safety/dashboard-before-corridor-map`. Corridor-map topic branches start from
and return to `experiment/corridor-traffic-map-development` so map work cannot
silently alter the approved dashboard checkpoint.

## Progress

- [x] Record the intended focused-corridor layout and non-goals.
- [x] Inventory the current dashboard, corridor geometry, flow summaries, and
  incident-map API.
- [x] Select the initial renderer and imagery candidate: MapLibre GL JS over
  USGS The National Map imagery.
- [x] Set one mile as the honest initial cell size, with half-mile cells as the
  desired result when source proof supports them. Quarter-mile cells are an
  optional measured outcome, not a project target.
- [x] Preserve the approved dashboard revision and create a separate map
  integration line.
- [x] Add bounded, in-memory spatial-evidence reporting to the normal zoom-10
  flow poll without adding provider requests or retaining raw tile payloads.
- [ ] Prove source resolution and carriageway assignment from representative
  zoom-10 flow features without increasing provider usage. Instrumentation is
  ready; representative evidence from a normal running poll is still required.
- [ ] Import and verify versioned two-carriageway geometry for both corridors.
- [ ] Implement and measure the spatial flow read model.
- [ ] Add the focused-corridor map panel and resilient imagery fallback.
- [ ] Add validated directional rendering and CDOT incident markers.
- [ ] Soak, measure, review, and decide whether to promote the experiment.

Update this section in the same focused commit that completes or materially
changes a plan item. Record abandoned assumptions in the relevant section
instead of leaving a checked item that no longer describes reality.

## Current implementation state

The first topic branch, `feature/corridor-flow-source-proof`, exposes decoded
flow features to a pure analyzer and records one bounded summary per corridor
after a successful normal poll. The internal endpoint
`/internal/traffic/flow-spatial-evidence` reports feature counts, tile-seam
duplicates, coverage tags, closure counts, feature-length and route-span
distributions, maximum route-match distance, and orientation relative to the
configured route coordinate order. It stores no raw geometry, credentials, or
provider response and performs no additional TomTom call.

The analyzer and endpoint have focused tests, and the complete ingest suite
passes in the repository's pinned Java 21 build image. No production or replay
deployment has been made. Direction labels and the final cell size remain
unresolved until this diagnostic observes both corridors during an ordinary
scheduled poll.

## Intended behavior

The All Corridors view stays as it is. When I-25 or I-70 is selected, keep that
corridor's incident table in one side of the existing panel and use the other
side for an interactive imagery map of the **selected** corridor. The map takes
the place of the hidden corridor's table; it must not show the other corridor's
traffic. On narrow screens, stack the incident table and map rather than
squeezing two columns together. Keep the incident table and its “See all”
behavior available.

Fit the map to the monitored mile-marker range (I-25 MM 208–271; I-70 MM
206–259), not the route's full bounding box. An outlined route remains visible
above the imagery. Short road stretches carry a consistent legend: normal,
slower than the local reference, severe slowdown, reported closure, or no
current evidence. Color is never inferred from the large speed-zone averages.
At corridor scale, show the worst **supported** direction for each short
stretch. When zoom and geometry make the carriageways distinguishable, show a
separate line for each supported direction—north/south on I-25 and east/west
on I-70. If a direction is missing or ambiguous, show that uncertainty instead
of assigning the other direction's condition to it. Clicking a stretch gives
direction, mile-marker interval, observed speed, reference, observation time,
and a plain-language reason for its color.

Incident markers can follow as an overlay. Their popups must distinguish CDOT
reports from measured TomTom flow and preserve source, direction, approximate
location, status, and first/last-seen times. A reported incident does not by
itself prove the adjacent flow is slow or closed. Replay and historical views
must use their existing time anchor; imagery is a geographic backdrop, **not**
live satellite traffic.

## What the project already has

- The dashboard focus switch is `applyCorridorFocus` in `dashboard.js`. CSS
  currently hides *every* element with the other corridor's `data-corridor`.
  The incident panel contains two route articles in `index.html`; selecting a
  route leaves one article stretched across the panel. The map needs its own
  selected-corridor state and narrower hide selectors.
- `/dashboard-api/traffic/map/corridors` already returns each corridor's
  GeoJSON LineString, mile-marker extent, and source metadata. The checked-in
  shapes in `routes-service/src/main/resources/routes/` are derived from one
  OSM relation/direction per corridor (`docs/corridor-geometry-sources.md`).
  They are not verified two-carriageway geometry.
- The current TomTom zoom-10, 60-second poll fetches about eight vector flow
  tiles across both corridors. `TileTrafficPoller` decodes feature paths and
  `traffic_level`, projects speeds to route points spaced half a mile apart,
  then persists corridor and broad-zone summaries. It discards individual flow
  paths after the poll. Those summaries cannot truthfully color quarter-mile
  stretches or distinguish northbound from southbound.
- Tile-backed corridor samples currently have no local free-flow value;
  `avgFreeflowSpeed` is null. The chart's corridor-wide three-month baseline
  cannot be reused as a local road-stretch reference. Existing archived
  samples and zone history therefore cannot be retroactively turned into
  minute, directional map history.
- `/dashboard-api/traffic/map/incidents/timeline` already supports `asOf` and
  returns tracked CDOT events as GeoJSON with snapped display geometry,
  direction, marker method/confidence, source and lifecycle fields. Its
  existing fallback supports pre-durable-event archives.

The replay API was not running during this planning pass. Before coding the
integration, inspect representative decoded flow tiles from an **already
scheduled** poll and the map API payload in a local ingestion-off replay.
Do not infer directionality or spatial resolution from documentation alone.

## Map and imagery choice

Use [MapLibre GL JS](https://maplibre.org/maplibre-gl-js/docs/) for the browser
renderer. It is BSD-3-Clause software and supports a raster imagery source,
GeoJSON line/point layers, viewport fitting, and data-driven styling. Pin a
reviewed version and serve its assets with the application; do not build the
page around an unpinned CDN script.

Start with the cached [USGS The National Map Imagery Only
service](https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer)
as the aerial-photo backdrop. The National Map says its services and data are
free/public-domain and requests agency acknowledgment. The service supplies
256px Web Mercator tiles, mainly NAIP aerial imagery for the continental US.
Call the UI control “Imagery,” not “live satellite”: image capture dates vary
and the photos do not depict current traffic. Trial the exact I-25 and I-70
extents at desktop/mobile sizes and carriageway zoom before relying on it.
Load only visible tiles, honor normal caching, and keep a neutral, labeled
fallback if imagery fails. A paid imagery service is a later option only if
quality or availability proves inadequate; it is not a prerequisite.

Keep TomTom credentials on the server. Do **not** load TomTom map or traffic
tiles directly from browsers: each viewer, pan, zoom, or refresh could add
unbudgeted requests and expose a key. Reuse decoded data from the scheduled
flow batch. Do not raise ingest zoom or shorten cadence merely for the map.
The current two-account primary-first budget is already planned around roughly
357,120 flow requests in a 31-day month; any proposed change to source zoom,
tile footprint, or polling requires a fresh measured quota projection.

The road geometry comes from the existing OSM-derived route data, expanded by
a **one-time, versioned** import of both carriageways within the tracked
windows. Validate motorway membership, travel direction, mile-marker anchors,
ramps/interchanges, bridges, and the I-70 tunnel against imagery and sample
flow features. Do not simply offset one centerline to invent a second side.
Use OSM attribution and review ODbL obligations for distributed geometry.
OSM's public tile server is not the production imagery plan.

## Turning flow features into trustworthy short stretches

1. **Pilot the source at no extra provider cost.** During one normal poll,
   inspect a bounded, redacted diagnostic of decoded feature shape, speed,
   `traffic_road_coverage`, `road_closure`, duplicates at tile seams, and
   match distances on several easy and difficult locations. The legacy vector
   tile's `traffic_level` is absolute km/h; `one_side` means coverage of one
   side of a two-way road, **not** a north/south/east/west label. Establish
   whether zoom 10 actually offers separate, stable traffic evidence for the
   two carriageways. Do not save raw tiles or secrets in test fixtures.
2. **Create stable route cells.** Use a fixed one-mile marker grid, identified
   by corridor, direction, and marker interval. Half-mile cells are preferred
   where the z10 source proof demonstrates stable local evidence; quarter-mile
   cells are acceptable only if measurement clearly supports them. These are
   still much smaller than today's broad speed zones. Clip the validated
   directional road geometry to the grid. If a source feature spans multiple
   cells without finer variation, preserve that shared evidence and its actual
   resolution; do not interpolate it into false local variation. Retain gaps
   as gaps.
3. **Match without guessing direction.** Associate decoded flow paths with
   the closest plausible carriageway and marker interval, using road class,
   geometric overlap, distance, and consistency along that road. Validate any
   use of feature path orientation against real samples first; path ordering
   alone is not proof of travel direction. Reject ambiguous features near
   ramps, crossings, merged carriageways, and tile seams. `road_closure`
   overrides speed only when its placement and direction are supported.
4. **Produce one observation per supported cell/direction/poll.** Weight
   overlapping feature speeds by covered road length, de-duplicate tile-edge
   copies, and retain observed-at time, source zoom, feature count, coverage,
   and quality state. Do not spread a nearby low speed across an entire zone.
   If matching cannot support a direction, emit `unknown`, not the opposite
   direction's speed. Compare the derived map state with the corridor summary
   without forcing the two metrics to equal each other.
5. **Classify relative to that location.** Build a clear-running reference
   from enough *new* cell history (for example a robust upper quantile across
   several days), then classify the ratio of current to reference with
   hysteresis so normal one-minute fluctuations do not flash red. Calibrate
   thresholds against actual I-25/I-70 distributions and known slow periods.
   Until reference coverage is adequate, show observed speed with a neutral
   “reference building” state, not a guessed congestion verdict. A separate
   time-of-week comparison can later distinguish ordinary rush hour from an
   unusual slowdown; label it separately from clear-running congestion.

TomTom's current legacy flow tiles expose absolute speed, road coverage, and
closure tags; they do not hand us the complete directional map model. Its
newer Orbis API has a different endpoint and tag schema. Keep the first map
iteration on the already-integrated endpoint; consider an Orbis migration as
separate provider work rather than silently changing this plan's data source.

## Data and API boundaries

Add a small, versioned directional geometry catalog and a current-cell state
read model. Serve bounded GeoJSON for one corridor/time anchor, including
`geometryVersion`, `observedAt`, `sourceZoom`, `direction`, marker interval,
speed, reference, condition, and `quality`. The API must never expose provider
credentials or raw tile responses. Use the same observation timestamp for all
cells in a completed poll and publish only after the batch is coherent.

Do **not** write every cell into every one-minute `traffic_sample`: at one mile
and two directions, both corridors would create up to about 232 cell rows per
minute before gaps; half-mile cells would create about 464. Keep one upserted
current row per cell/direction and plan durable hourly local-speed summaries
plus meaningful condition transitions for history and forecasting. Measure
actual populated cells, write rate, bytes/day, and query latency in the pilot
before fixing schema or retention details. No time-based purge or deletion of
existing corridor/zone history is part of this work. Document the first date
of real local-cell coverage; older replay must show “local flow unavailable
for this date” rather than deriving short-stretch colors from broad historical
averages. Incident history and the existing charts remain usable.

Map reads should be corridor-scoped, size-bounded, and cached with the current
poll timestamp/ETag. The client needs one initial geometry load and one
current-state refresh per dashboard cycle, not one request per visible cell.
Replay reads the time-appropriate historical resolution and says when it is
hourly rather than minute-level. Keep the map optional: basemap or spatial API
failure must not hide the incident table, speed charts, or status explanation.

## Small implementation sequence

1. **Source/geometry proof.** Produce redacted fixture-backed diagnostics from
   an existing scheduled tile batch, import and QA two directional OSM shapes,
   check USGS imagery quality. Exit criterion: credible direction assignment
   and a measured cell resolution for both corridors, including difficult
   merge/tunnel examples. If this fails, ship only a neutral route/incident
   map first; do not pretend the directional layer works.
2. **Spatial flow read model.** Add the fixed cells, matching/quality rules,
   current state, bounded history, and API on its own branch. Test tile seams,
   sparse coverage, opposing conditions, closures, stale polls, mile-marker
   bounds, archive continuity, and storage growth. Keep the existing summary
   and speed-zone outputs unchanged.
3. **Focused map panel.** On a separate branch, add MapLibre, USGS imagery,
   fit-to-corridor, route geometry, legend, states, responsive panel layout,
   keyboard/assistive labels, and a useful fallback. All Corridors and the
   incident table remain intact. Verify desktop and 390px mobile, light/dark,
   both corridors, no-WebGL, imagery failure, and no-data conditions.
4. **Directional detail and incidents.** Only after validated data exists,
   add zoom-dependent split lines, low-zoom worst-supported aggregation,
   incident markers/popups using the existing durable timeline, and links to
   table rows. Test one blocked direction against a slowed opposite direction,
   unknown sides, ambiguous geometry, out-of-range incidents, and replay.
5. **Soak before promotion.** Keep this on the experimental development line;
   review render performance, API latency, data quality, bytes/day, and quota
   ledger over at least a week before asking to promote to `main` or deploy.
   Each step is a focused PR with its own evidence and rollback notes.

## Decisions to confirm during the pilot

- Does the actual zoom-10 feature geometry and speed evidence support half-mile
  cells in both corridors, or should the first release stay at one mile? Treat
  quarter-mile support as a useful discovery, not a release requirement.
- Can enough features be assigned to the correct carriageway to justify a
  split line? What minimum coverage and maximum match distance avoid false
  direction claims near tunnels and interchanges?
- Does USGS imagery load consistently and make road sides discernible at the
  desired zoom on mobile? If not, select another *licensed* imagery provider
  with known cost/terms before implementation.
- What are the measured compressed bytes/day of hourly spatial history and
  condition transitions? Keep the design within the existing VPS headroom and
  backup path without silently shortening retained history.
- Confirm the current TomTom account terms permit the proposed persistent,
  publicly displayed derived cell history. This document makes no licensing
  assumption beyond the public API's technical description.

## Source references checked for this plan

- [MapLibre GL JS documentation](https://maplibre.org/maplibre-gl-js/docs/),
  [GeoJSON source](https://maplibre.org/maplibre-gl-js/docs/API/classes/GeoJSONSource/),
  and [license](https://github.com/maplibre/maplibre-gl-js/blob/main/LICENSE.txt)
- [USGS Imagery Only service](https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer),
  [cached imagery description](https://www.usgs.gov/faqs/what-are-urls-imagery-services-national-map-and-are-they-cached-or-dynamic),
  and [National Map usage terms](https://www.usgs.gov/faqs/what-are-terms-uselicensing-map-services-and-data-national-map)
- [OSM data license/attribution](https://www.openstreetmap.org/copyright) and
  [public tile usage policy](https://operations.osmfoundation.org/policies/tiles/)
- [TomTom legacy vector-flow format](https://docs.tomtom.com/traffic-api/documentation/tomtom-maps/v1/traffic-flow/vector-flow-tiles)
  and [Orbis migration guide](https://docs.tomtom.com/traffic-api/documentation/tomtom-orbis-maps/v1/product-information/migration-guide)
