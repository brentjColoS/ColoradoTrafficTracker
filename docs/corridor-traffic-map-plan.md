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
- [x] Persist the latest coherent cell state and durable hourly summaries with
  no automatic time-based deletion.
- [x] Add bounded corridor-scoped reads for the latest coherent snapshot and
  one requested UTC hourly bucket.
- [x] Add the responsive focused-corridor map panel, USGS imagery, the existing
  neutral route outline, and useful imagery/renderer fallback states.
- [x] Plot already-filtered CDOT incident points for only the selected corridor,
  with source/status context and the incident table preserved beside the map.
- [x] Render current and hourly combined-direction cells on the focused map.
  Keep the half-mile storage identities and aggregate them into one-mile
  display intervals with posted-speed comparison, source-quality context, and
  a truthful unavailable state before local history begins.
- [x] Keep the 2H, 6H, and 24H maps on the latest traffic snapshot, and use the
  7D and 30D maps to show where hourly slowdowns recur most often. Disclose
  actual historical coverage when the requested window predates map history.
- [x] Replace the row-limited speed-zone chart feed with bounded time buckets:
  one minute at 2H, five minutes at 6H, fifteen minutes at 24H, one hour at 7D,
  and three hours at 30D. Preserve every configured zone across the window.
- [x] Add conservative carriageway assignment for `one_side` flow paths that
  are measurably closer to one validated directional route. Combined cells are
  retained and ambiguous paths remain combined.
- [x] Evaluate validated directional traffic rendering after the source proof
  and spatial flow read model support it. Retain the evidence-gated backend,
  but retire the sparse split-line presentation in favor of complete
  combined-direction coverage.
- [x] Promote the spatial read model and conservative directional assignment to
  production `main`; keep the focused UI on the live experimental sidecar until
  the broader dashboard redesign is ready for promotion.

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
normal poll without additional provider requests. Production also replaces the
latest corridor status and supported cells transactionally in the database, and
each accepted observation contributes to one durable hourly row per corridor,
cell, and direction. The internal endpoint still serves memory and is empty
after a restart until the next successful flow batch. The public API exposes
one selected corridor at a time through
`/dashboard-api/traffic/map/flow-cells/current` and
`/dashboard-api/traffic/map/flow-cells/hourly`; it does not expose an unbounded
history range. Durable map history begins at `2026-09-24T21:00:00Z`.

Ingest now loads the checked-in two-carriageway catalog from routes-service and
tests each decoded `one_side` path against both corridor directions. It emits a
directional companion cell only when at least 80 percent of the path stays
within the directional route buffer, its mean match distance is at most 40
meters, and the winning route is at least 5 meters closer than the alternative.
Full-road, equidistant, incomplete-catalog, and otherwise ambiguous evidence
remains combined. Direction matching reuses the normal flow poll and adds no
TomTom requests. The production rollout is intentionally sparse where source
evidence is sparse; it does not infer the unavailable side of the road.

The focused dashboard now aggregates adjacent half-mile storage cells into
one-mile display intervals, then converts each interval into a route slice
using the configured mile-marker anchors. Current cells and historical hourly
cells use the same geometry and popup contract. The weighted speed and source
span retain the contribution of each underlying half-mile cell; partial source
coverage keeps the one-mile interval visibly partial.

Until a durable local clear-running reference is available per interval, the
color scale is explicitly relative to the CDOT posted-speed baseline. Above
105 percent is blue, 80–105 percent is green, 60–80 percent trends through
yellow, 35–60 percent trends through red, and below 35 percent trends through
dark red. The browser interpolates continuously between those anchors rather
than assigning only a handful of flat colors. Black is reserved for an
observed speed of 3 mph or less or current `FULL_REPORTED` closure evidence;
one-side and unresolved closure evidence remain disclosed in the popup without
making the entire combined interval black. Popups retain the combined
direction, weighted speed, source span, coverage quality, timestamp, and
comparison basis.

The live 2H, 6H, and 24H selections continue to use the latest coherent cell
snapshot and label its observation time as current traffic. The 7D and 30D
selections use the retained hourly cell summaries instead. For each half-mile
cell, the API counts sampled hours whose hourly average was below 80 percent of
the posted limit, then the browser combines adjacent cells into the same
one-mile display intervals. The long-range color scale runs from green through
dark red as slowdown frequency increases. Black remains reserved for intervals
whose hourly average reached 3 mph or less in at least 10 percent of sampled
hours. Popups show the underlying sampled-hour count, requested window, average
hourly speed, and available dates. This bounded read
adds no provider requests and cannot overstate early coverage: map history
still begins at `2026-09-24T21:00:00Z`, so a 7D or 30D request explicitly says
how many of those requested hours currently exist.

The directional geometry catalog and evidence-gated directional rows remain
available for future analysis, but the focused dashboard no longer fetches or
colors them. Measured directional coverage was too sparse to provide a useful
corridor-wide view. The UI now keeps one complete combined-direction line at
every zoom level and adds no provider requests.

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

### Measured directional projection

The first two ordinary polls after the September 24 directional rollout kept
all 232 combined cells and added the following evidence-gated rows. No extra
provider requests were made for this measurement.

| Corridor | Direction | Supported cells | Marker extent |
| --- | --- | ---: | --- |
| I-25 | Southbound | 10 | MM 212–217 |
| I-70 | Eastbound | 1 | MM 216–216.5 |
| I-70 | Westbound | 12 | MM 245–259 |

No I-25 northbound cells were assigned in these polls. That is a truthful
coverage result rather than a missing fallback: combined cells remain available
for the full corridor, and the focused map leaves unsupported carriageways
neutral at close zoom.

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
above the imagery. Short road stretches carry a consistent legend: above
expected, expected, slowing, heavy, severe, stopped, or no current evidence. Color
is never inferred from the large speed-zone averages.
Show one-mile combined-direction intervals across the full tracked route. This
is a presentation aggregation only: retain the half-mile storage and
evidence-gated directional rows so history and future analysis are not lost.
Clicking a stretch gives the combined direction, mile-marker interval,
weighted observed speed, posted-speed comparison, observation time, and a
plain-language explanation of source or closure evidence.

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

The focused panel uses the existing neutral corridor LineString from
`/dashboard-api/traffic/map/corridors`. It rejects incident features for
another corridor and features explicitly labeled off-corridor, but relies on
the server's tracked-mile filtering as the source of truth. Combined traffic
colors that centerline in one-mile intervals; the versioned two-carriageway
catalog is not required by the browser. Missing geometry, imagery, or WebGL
leaves the incident table available and presents a concrete explanation in the
map slot.

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
read model. The current state now uses one corridor snapshot row plus upserted
cell rows, so gaps and zero-cell snapshots retain a truthful status without
accumulating minute-level duplicates. Serve bounded GeoJSON for one
corridor/time anchor, including
`geometryVersion`, `observedAt`, `sourceZoom`, `direction`, marker interval,
speed, reference, condition, and `quality`. The API must never expose provider
credentials or raw tile responses. Use the same observation timestamp for all
cells in a completed poll and publish only after the batch is coherent.

Do **not** write every cell into every one-minute `traffic_sample`. The current
combined-direction projection has 232 configured half-mile cells across both
corridors; a future supported two-direction model could have up to 464. The
experimental schema keeps one upserted current row per cell/direction and one
hourly aggregate containing observation count, average/minimum/maximum speed,
coverage and closure counts, source-resolution bounds, and first/last observed
times. At the current combined coverage ceiling, that is 232 rows/hour, 5,568
rows/day, or about 2.03 million rows/year before gaps, rather than 334,080 rows/day
at one-minute storage. Hourly rows have no automatic time-based deletion.
Measure actual populated rows, compressed bytes/day, and query latency in the
pilot before adding indexes, condition transitions, or retention machinery. No
deletion of existing corridor/zone history is part of this work. Document the
first deployed date of real local-cell coverage; older replay must show “local
flow unavailable for this date” rather than deriving short-stretch colors from
broad historical averages. Incident history and the existing charts remain
usable.

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
   current state, durable hourly history, and API through focused branches. The
   fixed grid, pure projection, coherent in-memory publication, production
   measurement, weighted source-resolution metadata, durable current-state
   replacement, idempotent hourly summaries, bounded current/history reads,
   and evidence-gated directional assignment are complete. Continue testing
   tile seams, sparse coverage, opposing conditions, closures, stale polls,
   mile-marker bounds, archive continuity, and storage growth. Keep the
   existing summary and speed-zone outputs unchanged.
3. **Focused map panel.** The neutral first pass is implemented on an isolated
   branch: MapLibre, USGS imagery, fit-to-corridor, the existing route outline,
   responsive table/map layout, CDOT markers/popups, and explicit fallback
   states. All Corridors and the incident table remain intact. Desktop, 390px
   mobile, light/dark, both corridors, no-WebGL, missing geometry, and selected-
   corridor filtering have been checked. Imagery failure keeps the vector
   context visible with a labeled status.
4. **Corridor traffic detail.** Complete as one-mile combined-direction lines
   at every zoom level. The client derives them from the existing half-mile
   current/hourly contract, uses a continuous posted-speed-relative color
   scale, and keeps closure evidence separate from the measured speed unless a
   full-road closure or stopped-speed threshold is present. Directional rows
   stay in the backend for analysis but are not shown as sparse fragments.
5. **Operate and review.** The spatial backend and directional assignment are
   deployed on production `main`; the focused map is live on the read-only
   experimental sidecar. Continue reviewing render performance, API latency,
   directional coverage, bytes/day, and quota usage during ordinary operation.
   Moving the focused UI into the production dashboard remains part of the
   broader visual-overhaul decision, not a reason for more provider experiments.

## Decisions to confirm during the pilot

- The first read model uses half-mile cells for both corridors. A cell must
  retain source-span and quality metadata when its observation is shared across
  a longer path. Quarter-mile cells are out of scope for the first release.
- Directional assignment is measurable but too sparse at zoom 10 for the
  primary map. Keep its data and validation rules, but display complete
  one-mile combined-direction intervals unless a future source can provide at
  least 90 percent trustworthy directional coverage.
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
- September 23, 2026: added transactional current-state persistence on the
  experimental line. One metadata row per corridor preserves the observation
  status and explanation, while cell rows update in place and stale cells are
  removed within the same transaction. This does not create minute-level
  history.
- September 23, 2026: added durable hourly cell summaries on the experimental
  line. Each accepted observation updates one UTC hour bucket per supported
  cell and direction in the same transaction as current state. Replayed or
  out-of-order observations cannot inflate counts, gaps remain gaps, and no
  automatic time cutoff applies. Database growth and query latency still need
  measurement before longer-range analytics or index tuning.
- September 23, 2026: added public current and hourly flow-cell reads for one
  tracked corridor. Historical reads return only the UTC hour containing the
  requested time, keeping replay responses bounded to one map state.
- September 23, 2026: rendered the bounded current or hourly combined cells on
  the focused map. Each colored stretch retains its marker interval and source
  resolution; missing historical local state remains an explicit fallback.
- September 23, 2026: added evidence-gated directional cell assignment without
  changing the TomTom request schedule. Only distinct `one_side` paths may add
  carriageway rows, combined rows are retained, and ambiguous or incomplete
  directional evidence stays combined.
- September 24, 2026: added close-zoom directional traffic rendering using the
  validated carriageway catalog. The overview uses the worst supported
  direction, missing opposite-side observations are neutral rather than
  copied, unsupported cells stay combined, and geometry failure falls back to
  the combined map without affecting incidents or charts.
- September 24, 2026: deployed durable current and hourly flow-cell storage and
  bounded reads to production `main`. The first retained map-history hour is
  `2026-09-24T21:00:00Z`; every configured half-mile cell was supported on both
  corridors, and older replay remains explicitly unavailable at this detail.
- September 24, 2026: deployed the versioned carriageway endpoint and
  evidence-gated assignment to production `main`. Two ordinary polls retained
  all combined cells and added 10 I-25 southbound, 1 I-70 eastbound, and 12 I-70
  westbound cells. The live sidecar served both route catalogs and both bounded
  cell responses successfully without changing the TomTom request schedule.
- September 25, 2026: pivoted the focused map to complete one-mile
  combined-direction coverage. The presentation aggregates the retained
  half-mile current or hourly cells by overlap-weighted speed, preserves source
  and closure evidence, and uses a continuous blue-to-black scale relative to
  posted speed. Sparse directional rows remain stored but are no longer fetched
  by the dashboard. The change adds no TomTom requests.
- September 26, 2026: replaced the dashboard's 1,000-row speed-zone history
  read with a range-specific aggregate. Production-shaped validation returned
  all six I-70 zones across 169 hourly buckets for a seven-day window in 1,014
  bounded rows; longer views no longer silently show only their newest rows.
