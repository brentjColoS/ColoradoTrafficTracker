# Corridor traffic map plan

Started September 20, 2026 as a planning-only branch. This is now the living
implementation record for the corridor map experiment. The current dashboard
experiment remains preserved at `79fc2c6` on `experiment/dashboard-development`
and `safety/dashboard-before-corridor-map`. Corridor-map topic branches start
from and return to `experiment/corridor-traffic-map-development` through focused
pull requests so map work cannot silently alter the approved checkpoint.

## Progress

- [x] Record the intended focused-corridor layout and non-goals.
- [x] Inventory the current dashboard, corridor geometry, flow summaries, and
  incident-map API.
- [x] Select the initial renderer and imagery candidate: MapLibre GL JS over
  USGS The National Map imagery.
- [x] Verify the USGS imagery tile contract and road visibility at representative
  I-25 and I-70 locations.
- [x] Pin and self-host the MapLibre 6.10.0 renderer distribution and license
  without changing dashboard behavior.
- [x] Select half-mile cells for the initial read model after measuring the
  source. Preserve shared-source spans instead of claiming independent values,
  and keep quarter-mile cells out of the first release.
- [x] Preserve the approved dashboard revision and create a separate map
  integration line.
- [x] Add bounded, in-memory spatial-evidence reporting to the normal zoom-10
  flow poll without adding provider requests or retaining raw tile payloads.
- [x] Measure source resolution and carriageway coverage from representative
  zoom-10 flow features. The result supports a half-mile display grid only when
  cells retain shared-source provenance; it does not support a default
  directional split, especially on I-25.
- [x] Compare zoom 11 and zoom 12 in one bounded live experiment. Higher zoom
  improved the coarse tail but not typical path length or directional coverage
  enough to justify replacing the one-minute zoom-10 poll.
- [x] Import and verify versioned two-carriageway geometry for both corridors.
- [x] Expose the directional geometry catalog through a bounded, cacheable route
  endpoint without changing the existing corridor contract.
- [x] Define and unit-test stable half-mile cell identities, combined-direction
  length weighting, gap handling, closure provenance, and shared-source spans.
  This slice is runtime-neutral.
- [x] Publish a coherent in-memory cell batch after each existing flow poll and
  expose it through a bounded internal endpoint without adding provider calls.
- [x] Measure the live cell projection on the normal production poll. Both
  corridors populated every half-mile cell and retained shared-source spans,
  but the cells remain combined-direction display intervals rather than
  independent half-mile measurements.
- [ ] Add current-state persistence and the corridor-scoped public API after
  refining the cell-resolution metadata described below.
- [x] Add the responsive focused-corridor map panel, USGS imagery, the existing
  neutral route outline, and useful imagery/renderer fallback states.
- [x] Plot already-filtered CDOT incident points for only the selected corridor,
  with source/status context and the incident table preserved beside the map.
- [ ] Add validated directional traffic rendering after the source proof and
  spatial flow read model support it.
- [ ] Soak, measure, review, and decide whether to promote the experiment.

Update this section in the same focused commit that completes or materially
changes a plan item. Record abandoned assumptions in the relevant section
instead of leaving a checked item that no longer describes reality.

## Current implementation state

The source-proof work exposes decoded flow paths to a pure analyzer and records
one bounded summary per corridor after a successful normal poll. The internal
endpoint `/internal/traffic/flow-spatial-evidence` reports decoded feature and
path counts, tile-seam duplicates, coverage tags, closure counts, in-corridor
path-length and route-span distributions, match distance, and orientation
relative to configured route coordinate order. Disconnected paths are measured
independently, and each path is clipped to its longest contiguous portion inside
the 150-meter corridor buffer. It stores no raw geometry, credentials, or
provider response.

The diagnostic is running on production `main`; it does not change public
output or add requests to normal polling. The same corrections are carried into
the experimental map line before spatial-model work continues. The source proof
settles the initial grid at half-mile intervals, but it also establishes that
cell size is not a claim of independent half-mile measurements. Direction
labels remain gated on per-path matching quality rather than route order alone.

The read model defines stable half-mile marker cells and projects unique,
clipped flow paths into only the cells they overlap. Speeds are weighted by
covered marker distance, gaps remain absent, direction is explicitly
`COMBINED`, and every populated cell retains coverage quality, closure
provenance, and its coarsest contributing source span. After the normal flow
batch completes, ingest publishes the corridor snapshots together in memory.
`GET /internal/traffic/flow-cells` exposes that bounded current state for
measurement. This diagnostic is now running on production `main` and reuses the
normal poll without additional provider requests. The state is empty after a
restart until the next successful flow batch. It does not persist history,
expose a public map API, or render traffic colors yet.

### Measured source evidence

The September 22 production zoom-10 cycle used the normal eight-request poll.
After removing disconnected and off-corridor geometry from the measurement, it
reported:

| Corridor | Unique paths | `one_side` | `full` | Median path | p90 path | Longest path |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| I-25 | 134 | 2 | 132 | 0.318 mi | 3.703 mi | 18.709 mi |
| I-70 | 96 | 31 | 65 | 0.265 mi | 3.391 mi | 20.349 mi |

Twenty minutes later, another ordinary cycle reported 134 and 95 unique paths,
medians of 0.325 and 0.269 mile, and effectively unchanged p90 values. That
confirms the measured granularity is primarily structural rather than a
one-cycle traffic anomaly.

The long tail is real corridor-overlapping geometry, not the earlier analyzer
error. It means several adjacent half-mile cells will sometimes share one
TomTom observation. The read model must expose that shared source span and must
not manufacture local variation between those cells.

A disposable, opt-in live-test branch then compared one z11 and one z12 pass.
The successful comparison used 15 and 29 requests respectively; including an
initial budget-planner check, the experiment consumed 52 requests under an
80-request ceiling. Those direct checks used primary-account reserve headroom
and are not included in the application's monthly ledger; actual provider
headroom is 52 requests lower until the next reset. No experimental code was
retained.

| Zoom | Corridor | Unique paths | `one_side` | Median path | p90 path | Longest path |
| ---: | --- | ---: | ---: | ---: | ---: | ---: |
| 11 | I-25 | 189 | 7 | 0.358 mi | 2.770 mi | 9.133 mi |
| 11 | I-70 | 129 | 35 | 0.285 mi | 2.816 mi | 10.960 mi |
| 12 | I-25 | 211 | 7 | 0.381 mi | 2.716 mi | 4.721 mi |
| 12 | I-70 | 153 | 38 | 0.291 mi | 2.432 mi | 5.429 mi |

Higher zoom reduced worst-case spans and modestly improved the p90. It did not
improve the median or I-25 directional coverage. At the existing one-minute
cadence, z11 and z12 also exceed the monthly target and are correctly downgraded
by the budget planner. An occasional quota-aware enrichment pass may be studied
later, but it is not required for the first spatial read model.

### Measured cell projection

The September 23 production deployment published its first complete cell batch
from the existing eight-request zoom-10 poll. A second ordinary cycle repeated
the same structure. No separate provider request was made for this measurement.

| Corridor | Supported cells | Projected paths | Seam duplicates | Median coarsest source | p90 coarsest source | Longest coarsest source |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| I-25 | 126 / 126 | 131 | 2 | 9.871 mi | 18.693 mi | 18.693 mi |
| I-70 | 106 / 106 | 100 | 1 | 11.814 mi | 13.096 mi | 13.096 mi |

`FULL_CELL` means the union of projected source intervals covered the full
half-mile marker interval. It does not mean the cell has an independent
half-mile observation. The coarsest-source figures above are intentionally
conservative: a long contributor can overlap many cells even when shorter
features also contribute local evidence. The underlying source distributions
remained consistent with the earlier diagnostic, with median individual path
spans of 0.310 mile on I-25 and 0.244 mile on I-70 and p90 spans of 3.730 and
4.041 miles respectively.

The projection still produced local variation: the I-25 batch had 55 distinct
two-decimal cell speeds and 26 adjacent changes of at least 3 mph; I-70 had 36
distinct speeds and 31 such changes. That supports half-mile cells as stable
display and storage identities, provided the shared-source provenance remains
visible. It does not support quarter-mile cells or unconditional directional
coloring. Each cell now retains its finest, contribution-length-weighted, and
coarsest source spans so downstream quality labels can distinguish cells
dominated by local evidence from cells dominated by a long shared feature.

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

Representative decoded flow evidence has now been inspected from scheduled
production polls and a bounded higher-zoom comparison. Continue to use the
ingestion-off replay for client work. Do not infer directionality from path
ordering or treat the half-mile route sampling grid as independent source
resolution.

The first focused panel deliberately uses the existing neutral corridor
LineString from `/dashboard-api/traffic/map/corridors`. It rejects incident
features for another corridor and features explicitly labeled off-corridor,
but relies on the server's tracked-mile filtering as the source of truth. It
does not use the pending two-carriageway endpoint or color any road segment by
traffic state. Missing geometry, imagery, or WebGL leaves the incident table
available and presents a concrete explanation in the map slot.

## Map and imagery choice

Use [MapLibre GL JS](https://maplibre.org/maplibre-gl-js/docs/) for the browser
renderer. It is BSD-3-Clause software and supports a raster imagery source,
GeoJSON line/point layers, viewport fitting, and data-driven styling. Version
6.10.0 is pinned under `static/dashboard/vendor/maplibre-gl/6.10.0`; its exact
files, hashes, license, and update procedure are recorded in
[`maplibre-renderer.md`](maplibre-renderer.md). The dashboard will load these
application-owned assets rather than renderer code from a CDN.

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

The September 20, 2026 proof confirmed that the service's supported z16 imagery
visibly separates both carriageways at urban, rural, and mountain samples from
the monitored corridors. The tile endpoint also permits direct cross-origin
browser requests and publishes a one-day cache lifetime. See
`docs/corridor-map-imagery.md` for the tested locations, integration contract,
attribution, and limits. This establishes a suitable backdrop; it does not
validate traffic direction or local flow resolution.

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

1. **Pilot the source with a bounded diagnostic.** This is complete. Normal
   zoom-10 polls now expose a redacted summary of decoded path shape, speed,
   `traffic_road_coverage`, `road_closure`, duplicates at tile seams, and
   match distances. A separate 52-request experiment compared z11 and z12
   without changing production cadence. The legacy vector
   tile's `traffic_level` is absolute km/h; `one_side` means coverage of one
   side of a two-way road, **not** a north/south/east/west label. I-25 does not
   have enough `one_side` coverage to justify a default split. Do not save raw
   tiles or secrets in test fixtures.
2. **Create stable route cells.** Use a fixed half-mile marker grid, identified
   by corridor and marker interval, with direction present only when matching
   evidence supports it. Do not pursue quarter-mile cells for the first model.
   These cells are still much smaller than today's broad speed zones. Clip the
   validated directional road geometry to the grid. If a source feature spans
   multiple cells without finer variation, preserve that shared evidence and
   its actual resolution in every affected cell; do not interpolate it into
   false local variation. Retain gaps as gaps.
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

The geometry portion is available from
`GET /routes/corridors/{corridor}/directions`. It returns only I-25 or I-70,
uses the checked-in version 1 FeatureCollection, and permits one day of browser
caching. This is a static catalog endpoint; the future current-cell state stays
separate so traffic refreshes do not repeatedly transfer the road geometry.

## Small implementation sequence

1. **Source/geometry proof.** Complete for initial implementation. Redacted
   diagnostics now measure both corridors, the directional OSM shapes are
   versioned, and USGS imagery is checked. The evidence supports half-mile cells
   with shared-source metadata but does not support unconditional directional
   rendering. Difficult merge/tunnel assignment remains part of the read-model
   quality work, and ambiguous cells must stay combined or unknown.
2. **Spatial flow read model.** Add the fixed cells, matching/quality rules,
   current state, bounded history, and API on its own branch. The fixed grid,
   pure projection, coherent in-memory publication, and production measurement
   are complete, including weighted source-resolution metadata. Persist current
   state and bounded hourly history next. Test tile seams, sparse coverage, opposing
   conditions, closures, stale polls, mile-marker bounds, archive continuity,
   and storage growth. Keep the existing summary and speed-zone outputs
   unchanged.
3. **Focused map panel.** The neutral first pass is implemented on an isolated
   branch: MapLibre, USGS imagery, fit-to-corridor, the existing route outline,
   responsive table/map layout, CDOT markers/popups, and explicit fallback
   states. All Corridors and the incident table remain intact. Desktop, 390px
   mobile, light/dark, both corridors, no-WebGL, missing geometry, and selected-
   corridor filtering have been checked. Imagery failure keeps the vector
   context visible with a labeled status.
4. **Directional traffic detail.** Only after validated flow data exists, add
   zoom-dependent split lines and low-zoom worst-supported aggregation. Keep
   the current incident overlay and table as independent reported-event
   context. Test one blocked direction against a slowed opposite direction,
   unknown sides, ambiguous geometry, out-of-range incidents, and replay.
5. **Soak before promotion.** Keep this on the experimental development line;
   review render performance, API latency, data quality, bytes/day, and quota
   ledger over at least a week before asking to promote to `main` or deploy.
   Each step is a focused PR with its own evidence and rollback notes.

## Decisions to confirm during the pilot

- The first read model uses half-mile cells for both corridors. A cell must
  retain source-span and quality metadata when its observation is shared across
  a longer path. Quarter-mile cells are out of scope for the first release.
- Can enough features be assigned to the correct carriageway to justify a
  split line? What minimum coverage and maximum match distance avoid false
  direction claims near tunnels and interchanges?
- Does USGS imagery load consistently and make road sides discernible at the
  desired zoom on mobile? If not, select another *licensed* imagery provider
  with known cost/terms before implementation.
- What are the measured compressed bytes/day of hourly spatial history and
  condition transitions? Keep the design within the existing VPS headroom and
  backup path without silently shortening retained history.
- Is occasional z11 or z12 enrichment worth its incremental monthly requests
  after the z10 read model is measured? Any trial must reserve the normal
  one-minute baseline first, stay below the per-account hard stop, and replace
  rather than duplicate a scheduled z10 cycle.
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

## Implementation log

- September 20, 2026: added an unused version-1 directional geometry catalog
  for both corridors from pinned OSM relation versions. The repeatable importer
  verifies relation identity, continuity, monitored bounds, endpoint gaps,
  route length, and distance from the existing monitored reference. Detailed
  source and QA records are in `docs/corridor-geometry-sources.md`. Runtime
  routing, incident snapping, ingestion, and dashboard output are unchanged.
- September 22, 2026: deployed the bounded zoom-10 path diagnostic, corrected
  multi-path and corridor-boundary measurement errors, and captured the source
  distributions above. A disposable z11/z12 comparison used 52 requests under
  an 80-request ceiling. The result selects half-mile display cells with
  explicit shared-source provenance and rejects unconditional directional
  coloring for the first read model.
- September 23, 2026: deployed the in-memory half-mile projection through
  production `main` and measured two normal poll cycles. All 232 configured
  cells were covered and local speed variation remained visible, while long
  shared features contributed to many cells. Keep the half-mile grid, retain
  combined direction, and retain finest, weighted, and coarsest source spans
  before persistence or public traffic coloring.
