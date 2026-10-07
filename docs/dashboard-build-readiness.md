# Dual-corridor dashboard: local build readiness

## Branch assessment

The completed dashboard baseline is integrated with the current application on
the experimental development line. Production `main` remains unchanged. See
`docs/dashboard-experiment-status.md` for the topic boundaries, product
constraints, parked alternatives, and branch flow.

The established hierarchy uses dark green navigation, two compact corridor
summaries, two stacked speed charts, side-by-side incident tables, a
system/pipeline strip, and an architecture strip. It remains an HTML/CSS/
JavaScript dashboard served by Spring Boot.

## Changed-file responsibilities

| Files | Responsibility |
| --- | --- |
| `static/dashboard/index.html` | Semantic page, controls, navigation, route metrics, tables and status strips. |
| `static/dashboard/dashboard.css` | Palette, responsive layout, focus states, light/dark themes and readable metrics. |
| `static/dashboard/dashboard.js` | Bounded API requests, partial failure handling, metrics, event lifecycle rendering, canvas charts, demo mode and retained-data replay. |
| `static/dashboard/interstate-25.svg`, `interstate-70.svg` | Compact shields for route signs and chart lanes. |
| `CurrentIncidentRepository`, `CurrentIncidentProjection`, `CurrentMapIncident`, `TrafficMapController` | Recent-event API including ended events, explicit active state and original lifecycle timestamps. Existing active-only map endpoint remains active-only. |
| `TrafficAnalyticsController`, `TrafficAnalyticsRepository`, `TrafficController`, `TrafficSpeedZoneSampleRepository` | Optional `asOf` bounds for read-only trend and speed-zone replay without changing the live defaults. |
| `scripts/tests/dashboard.test.cjs` | Dependency-free frontend regression tests, also run in CI. |
| `scripts/tests/dashboard-preview.cjs` | Local synthetic API fixture preview for manual browser checks; never part of the application runtime. |
| `.dockerignore` | Excludes local worktrees, local environment material, dependency caches and node modules from the Docker build context. |

Static paths above are under `api-service/src/main/resources/`; Java classes are
under `api-service/src/main/java/com/example/api_service/`.

## Corrections and data semantics

- Incident tables now use durable `firstSeenAt`, `lastSeenAt` and `active` fields.
  An old but still active provider event is not silently marked ended after 45
  minutes. Recent ended events are included by a separate endpoint rather than
  changing the active-only map contract. Queries preserve tracked-corridor and
  mile-marker bounds. The UI deduplicates by provider, corridor and event ID.
- “See all” expands the route's returned incidents and can collapse again. The
  API caps each route at 1,000 events. At the cap, the status notes the limit and
  the active count is marked as a lower bound. Incident retrieval covers at
  least 24 hours, or the selected chart range when longer, plus active events.
- Speed charts use hourly rollups. The baseline is refreshed once per Denver
  week from the preceding 13 completed weeks and matches each point by Denver
  weekday and hour. An eight-week recency half-life keeps recent patterns more
  prominent, while robust weighting limits isolated outliers. Exact weekday
  profiles require eight observations; sparse cohorts fall back to the matching
  weekday/weekend hour only when that broader cohort also has at least eight.
  Missing profiles use the earlier seven-day calculation as a display fallback;
  current/free-flow speeds are not passed off as historical baselines. The
  adjustable reference band is descriptive historical variability, not a
  confidence interval, and its displayed coverage is measured from the matching
  history. Corridor axes fit the current and baseline lines rather than the
  statistical band's outer bounds, so unusually broad variability is clipped at
  the plot edge instead of flattening the recent-speed signal.
- Focused speed-zone charts use the same weekly refreshed, 13-week baseline
  method as the corridor charts, with an independent scale and reference band
  for each zone. Incident callouts appear only on the zone containing the
  report's tracked mile marker; reports without a usable marker remain in the
  incident table instead of being placed on a guessed zone.
- Live chart windows remain anchored to now. Retained-data replay is explicitly
  selected with `?historical=1` and anchors the chart and speed-zone lookup to
  each corridor's last stored sample. It is labeled historical, disables timed
  refresh, and can rebuild incident rows from the retained snapshot payload when
  the newer incident-event tables have no matching history. It does not alter
  stored timestamps or invoke an ingestion provider. Collection gaps are not
  joined by a misleading continuous line. Up to three non-overlapping incident callouts are
  shown at their event time, using the nearest hourly speed only when within
  one hour. A last-seen callout is labeled when the original first sighting is
  outside the window. The tables retain the rest of the events.
- Estimated travel time sums the travel time across the current combined-direction
  half-mile cells (63 miles for I-25; 68 for I-70 through I-25). It falls back to distance
  divided by the latest corridor average only when complete cell coverage is
  unavailable. It is an estimate, not a measured or direction-specific journey.
- The fastest and slowest estimates for the day compare that current estimate
  with complete 15-minute speed-zone estimates since Denver midnight. Each
  historical estimate sums `zone distance / zone speed` across the full corridor;
  partial or gapped buckets are excluded. The range is derived on each refresh,
  so the previous day drops out on the first refresh after midnight.
- Worst segment is the slowest combined-direction half-mile cell in the same
  current snapshot. The latest speed-zone bucket is used only when current cell
  data is unavailable; an incident hotspot is never substituted for traffic data.
- API/database/pipeline states use current checks. Successful historical reads
  do not override failed health requests. Route status describes stored catalog
  availability, not a direct routes-service liveness probe. Pipeline status uses
  the backend's flow, incident and provider freshness checks. Sample counts are
  labeled as the selected chart window; the latest sample is explicitly usable
  flow data, not a claim about the latest poll of every provider.
- Fetch timeouts, independent endpoint failures, refresh/range races, disabled
  browser storage, missing values, dark contrast, and long labels are handled.
  Demo mode is labeled as sample data. Its I-25 locations are inside the actual
  208–271 tracked span rather than Monument/Castle Rock from the illustration.
- Live and retained-data views preload the 2-hour, 6-hour, 24-hour, 7-day, and
  30-day dashboard snapshots as one synchronized set. Timeframe, corridor,
  overall/speed-zone, reference-band, and theme controls render from that local
  set without starting API reads. The automatic 60-second sync and the manual
  **Sync now** action replace the set in the background; shared endpoint reads
  are deduplicated within a cycle, and a partial failure keeps the last good
  value for the affected slice while reporting the failure. The corridor map
  renderer is also warmed during startup. Local replay remains an advancing,
  selected-range diagnostic and keeps its five-second replay cycle.

## Verification

- After integration with current `main`, `./mvnw clean verify` passed for all
  modules at the Java 21 release target. The API module ran 144 tests and met
  its coverage gates.
- All 70 dependency-free dashboard regression tests passed.
- `./scripts/verify-resilience.sh` passed its shell, backup, auto-update,
  health-check, and Compose checks.
- Compose configuration validation passed with placeholder configuration and
  without starting services or contacting providers.
- Browser checks cover the 1718×916 desktop reference size, 390×844 mobile,
  both themes, corridor focus, time ranges, eight-row incident expansion,
  dense/long labels, healthy fixtures, partial outage, empty data and full outage.
- Earlier live PostgreSQL and API smoke tests passed against the retained local
  volume.
  The volume contains 88,912 samples for each corridor from April 10 through
  June 19, 2026, plus 121,575 I-25 and 243,150 I-70 speed-zone rows. The newer
  incident-event table has no historical rows, so replay uses each latest
  sample's incident snapshot (four I-25 and two I-70 incidents).
- The API image was built at the Java 21 target and the browser-rendered replay
  was checked against the real local payloads. PostgreSQL and `api-service` were
  healthy during that review;
  `ingest-service`, `routes-service`, and `https-proxy` remain stopped. No
  provider-backed smoke test was run and no TomTom calls were made.

Useful repeatable checks (Java 21 required):

```bash
./mvnw -q -pl api-service -am verify
node --test scripts/tests/dashboard.test.cjs
docker compose config --quiet
```

For a container-free visual review, serve only the public static directory:

```bash
python3 -m http.server 8090 --bind 127.0.0.1 --directory api-service/src/main/resources/static
# http://127.0.0.1:8090/dashboard/?demo=1
```

For synthetic API browser testing:

```bash
node scripts/tests/dashboard-preview.cjs
# http://127.0.0.1:8091/dashboard/?fixture=live
# Other scenarios: partial, empty, offline. All are explicitly labeled fixtures.
```

## Bounded animation comparison

The information pages draw hover borders with two rounded SVG strokes. Their
normalized dash lengths follow the panel perimeter at any size. Grid sweeps move
a gradient behind a stationary grid mask, including a soft halo; the grid itself
does not move. Architecture panels and connectors share the same floating-motion
clock, and their positions are recalculated only after layout changes. The whole
diagram pauses together offscreen. Reduced-motion preferences disable floating
and sweeping motion and show the completed border immediately on interaction.
The Data interpretation panel and API access-limits panel sweep left to right,
matching the live-health panel; their diagonal beam and stationary grid remain
unchanged. The map legend keeps its pace note on a dedicated row and reserves
space around the decorative corner at every width, rather than depending on a
viewport breakpoint for the note to fit.

The noninteractive data-page map projects its existing corridor geometry into
native transform keyframes for two small green and rose pulses, only when fitted
or resized. Each pulse travels the full geometry and back, taking one second per
displayed minute of estimated travel time in each direction. The dashboard and
map share the same estimate: complete fresh half-mile cells first, corridor
distance divided by the latest average speed otherwise. The map reads cached
summary and current-cell endpoints once a minute while visible, with eight-second
request timeouts; these reads do not request provider data. Missing estimates
hide the pulse, and older observations are labeled retained. This is illustrative
pace, not a vehicle position or direction-specific measurement.

Native Web Animations move only the two small pulse layers without JavaScript
animation loops, continuous geometry projection or WebGL paint updates. New
estimates change playback rate without resetting progress; resize preserves
progress too, and disconnected geometry parts are not bridged. Offscreen and
hidden-page pauses remain in place, and reduced motion hides the pulses while
retaining the solid geometry. No animation library or runtime profiler is added.
This follows the browser guidance to favor [opacity and transform
animations](https://web.dev/articles/animations-and-performance), with projection
provided by [MapLibre's map API](https://maplibre.org/maplibre-gl-js/docs/API/classes/Map/#project).

The traveling-pulse follow-up was checked at outbound midpoint, far endpoint and
return midpoint: both directions stayed on the same geometry, with 52,000 ms and
62,000 ms one-way durations matching the local dashboard's retained 52- and
62-minute estimates. A single eight-second running-pulse sample measured 480
frame intervals, median 16.7 ms, p95 17.6 ms, no intervals over 25 ms, no long
tasks and no bounding-rectangle reads. This bounded check is not a total CPU/GPU
utilization measurement. Desktop and 390 px mobile layouts retained visible
glows and readable legends.

For a short local comparison against the original and first performance
checkpoints, run:

```bash
node scripts/tests/dashboard-motion-preview.cjs
# http://127.0.0.1:8092/dashboard/system.html?motionRevision=current
# http://127.0.0.1:8092/dashboard/data.html?motionRevision=current
```

The toolbar selects `current`, `original` (`91ba877`), or `stripped` (`32e3689`).
Each sample ends after eight seconds. Panel samples alternate focus; grid and map
samples keep the selected section visible. The probe records animation-frame intervals,
main-thread long tasks, and bounding-rectangle reads, then removes its temporary
instrumentation. **Freeze visual** captures a partial border or the middle of a
wave and hides the toolbar; reload to restore normal motion. This tool runs only
on loopback and proxies GET requests to the existing local API on port 8080. It
does not start ingestion and is not included in the website.

On October 6, 2026, the final desktop samples in the in-app browser delivered
480 measured intervals per eight seconds, a 16.7 ms median and 17.6 ms 95th
percentile for the panel, gold-grid and map-pulse scenes. None had an
interval over 25 ms, a long task, or a bounding-rectangle read. The original
architecture sample made 5,181 bounding-rectangle reads in eight seconds. These
short observations establish frame cadence and removal of repeated geometry
work on this machine; they do not measure total GPU utilization or promise the
same timings on every computer.

## Ingestion-off retained-data replay

Start only PostgreSQL and the API to inspect retained data without polling the
providers:

```bash
docker compose up --build -d db api-service
# http://localhost:8080/dashboard/?historical=1
```

The historical query parameter changes only read windows and labels; it does not
start ingestion or rewrite timestamps. The ordinary `/dashboard/` remains the
live, now-anchored view and will correctly look stale or empty while ingestion is
off. Do not use unscoped `docker compose up` for this testing path because that
also starts the configured ingestion service and can make real provider calls.
No remote deployment is part of this work.
