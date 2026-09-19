# Dual-corridor dashboard: local build readiness

## Branch assessment

The local branch initially pointed to `9f029a0`, containing the older dashboard.
The remote branch contained `1de3822` (the redesign) and `fd2daa4` (the handoff),
based on an older backend. The integration preserves the newer backend work and
uses the remote dashboard as the visual foundation.

The supplied reference and handoff guide the hierarchy: dark green navigation,
two compact corridor summaries, two stacked speed charts, side-by-side incident
tables, system/pipeline strip, and architecture strip. This remains an HTML/CSS/
JavaScript dashboard served by Spring Boot; the reference's React/TypeScript
caption was illustrative, not the actual implementation.

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
- Estimated average delay compares full-corridor travel time at average speed
  with free-flow speed (63 miles for I-25; 53 for I-70). It is explicitly an
  estimate, not a measured end-to-end journey. Missing inputs show a dash.
- Worst segment is the slowest zone average in the same snapshot as the current
  summary. Its location is no longer an unrelated incident hotspot paired with
  the corridor's minimum speed. Missing or stale zones show “No current zone data.”
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

## Verification

- Java 21 API reactor `verify`: 130 tests, packaging and coverage gates passed
  before the replay follow-up. The replay follow-up adds two controller tests;
  all Maven tests pass, and the Docker Java 21 build packages successfully.
- All application modules package successfully with Java 21. The current local
  `.env` exists and both provider-key fields are populated; values were not printed
  or changed, and provider authentication has not been tested during this work.
- JavaScript syntax and the 16 frontend regression tests passed.
- Compose configuration validation passed without starting Docker.
- Browser checks cover the 1718×916 desktop reference size, 390×844 mobile,
  both themes, corridor focus, time ranges, eight-row incident expansion,
  dense/long labels, healthy fixtures, partial outage, empty data and full outage.
- Live PostgreSQL and API smoke tests passed against the retained local volume.
  The volume contains 88,912 samples for each corridor from April 10 through
  June 19, 2026, plus 121,575 I-25 and 243,150 I-70 speed-zone rows. The newer
  incident-event table has no historical rows, so replay uses each latest
  sample's incident snapshot (four I-25 and two I-70 incidents).
- The API image was built with Java 21 and the browser-rendered replay was checked
  against the real local payloads. PostgreSQL and `api-service` are healthy;
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
