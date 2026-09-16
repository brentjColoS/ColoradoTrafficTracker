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
| `static/dashboard/dashboard.js` | Bounded API requests, partial failure handling, metrics, event lifecycle rendering, canvas charts and demo mode. |
| `static/dashboard/interstate-25.svg`, `interstate-70.svg` | Compact shields for route signs and chart lanes. |
| `CurrentIncidentRepository`, `CurrentIncidentProjection`, `CurrentMapIncident`, `TrafficMapController` | Recent-event API including ended events, explicit active state and original lifecycle timestamps. Existing active-only map endpoint remains active-only. |
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
- Speed charts use hourly rollups. Each point's baseline is the mean of earlier
  observations at the same Denver local hour in the preceding 168 hours. The
  30-day view fetches additional lookback rather than substituting a 30-day
  baseline. Missing baselines stay absent; current/free-flow speeds are not
  passed off as measured historical baselines. The ±10 mph shading is labeled
  a fixed reference band, not a statistical confidence interval.
- Chart windows remain anchored to now. Collection gaps are not joined by a
  misleading continuous line. Up to three non-overlapping incident callouts are
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

- Java 21 API reactor `verify`: 130 tests, packaging and coverage gates passed.
- All application modules package successfully with Java 21. The current local
  `.env` exists and both provider-key fields are populated; values were not printed
  or changed, and provider authentication has not been tested during this work.
- JavaScript syntax and the 13 frontend regression tests passed.
- Compose configuration validation passed without starting Docker.
- Browser checks cover the 1718×916 desktop reference size, 390×844 mobile,
  both themes, corridor focus, time ranges, eight-row incident expansion,
  dense/long labels, healthy fixtures, partial outage, empty data and full outage.
- Live PostgreSQL query execution, Docker image construction and provider-backed
  smoke tests remain pending: Docker's daemon was stopped, and container startup
  is explicitly gated on the user's approval. Fixture tests do not substitute
  for those final runtime checks.

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

## Container-start approval gate

No application container has been started for this assessment. Do not run the
following step until the user explicitly approves starting the local stack:

```bash
docker compose up --build -d
```

Docker Desktop/Engine must be running first. Use the existing local `.env` and
database volume; do not overwrite credentials or delete volumes. This starts
the configured ingest services and can make real provider requests. The default
dashboard address is `http://localhost:8080/dashboard/`. After approval, verify
Compose health, both corridor summaries, recent incident lifecycles and the
rendered dashboard against actual local payloads. No remote deployment is part
of this work.
