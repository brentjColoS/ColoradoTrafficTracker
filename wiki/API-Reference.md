![Colorado Traffic Tracker](https://raw.githubusercontent.com/brentjColoS/ColoradoTrafficTracker/main/docs/assets/ctt-wordmark.svg)

The [API explorer](https://coloradotraffictracker.net/dashboard/api.html) provides
read-only queries against stored traffic data. Original observations, derived
summaries and geographic coverage are separate contracts; choose the read that
matches the question.

## Access and credentials

The website uses public, read-only `/dashboard-api/` routes. Equivalent `/api/`
routes require an API key when API security is enabled. Both query retained data;
collection has its own schedule. The optional basemap key has separate
browser-map restrictions and is not a traffic-collection credential.

## Useful queries

Examples use I-25 where a corridor is required.

| Read | Use |
| --- | --- |
| [`traffic/latest`](https://coloradotraffictracker.net/dashboard-api/traffic/latest?corridor=I25) | Latest retained corridor observation and recorded time. |
| [`traffic/history`](https://coloradotraffictracker.net/dashboard-api/traffic/history?corridor=I25&windowMinutes=1440&limit=2000&includeIncidents=false) | Original observations for a chart or daily minimum. |
| [`traffic/analytics/baselines`](https://coloradotraffictracker.net/dashboard-api/traffic/analytics/baselines?corridor=I25) | Matched profiles, source counts and historical variation. |
| [`traffic/map/corridors`](https://coloradotraffictracker.net/dashboard-api/traffic/map/corridors) | Tracked road geometry and monitored extents. |
| `traffic/dashboard/window-summary` | Speed, estimated travel time and incident summaries for a selected historical window. |

## Raw history and pagination

`GET /dashboard-api/traffic/history` includes archived corridor observations.
For speed-only reads:

| Parameter | Contract |
| --- | --- |
| `corridor` | `I25` or `I70`. |
| `windowMinutes` | 1–10,080 minutes; defaults to 180. |
| `limit` | 1–2,000 with `includeIncidents=false`; defaults to 120. |
| `includeIncidents` | Set `false` for the compact speed-only limit; defaults to `true`. |
| `preferUsable` | Defaults to `false`; retain that value when accounting for all original observations. |
| `asOf` | Optional ISO timestamp defining the window end; omission uses the current time. |

Rows are newest first. With an explicit `asOf`, the timestamp boundary is
inclusive. A response reaching the limit may omit older rows: set the next
`asOf` to the earliest returned `polledAt` and deduplicate by `sampleRefId`
across the overlap. That logical identity remains stable after archival.

Pagination uses a timestamp without an ID tie-break cursor, and separate pages
do not share a database snapshot. If a full page cannot move the cursor backward, the
[publisher implementation](https://github.com/brentjColoS/ColoradoTrafficTracker/blob/main/operations/portfolio/publish.py)
rejects the incomplete read.

## Historical window summaries

The dashboard's aggregate endpoint requires `hours` and `asOf`:

```text
GET /dashboard-api/traffic/dashboard/window-summary
    ?corridors=I25,I70
    &hours=24
    &asOf=2026-11-20T18:00:00Z
    &progressive=true
```

`corridors` defaults to both routes. `asOf` must be an ISO timestamp no more than
one minute in the future. Supported windows determine the speed-zone bucket
resolution:

| Window (`hours`) | Bucket minutes |
| --- | --- |
| 2 | 1 |
| 6 | 5 |
| 24 | 15 |
| 168 | 60 |
| 720 | 180 |

The normal JSON response maps corridor codes to summaries. With
`progressive=true`, the response is `application/x-ndjson`: each line contains
`summaries` and a `complete` flag. Speed and travel fields can arrive before
incident reconstruction. The stream sets `Cache-Control: no-store` and disables
proxy buffering through `X-Accel-Buffering: no`.

Clients must inspect `speedAvailable`, `zonesAvailable`, `incidentsAvailable`
and `busy` alongside the values. An unavailable incident count is not zero.
`travelMethod` and `incidentMethod` identify how results were assembled;
`RECONSTRUCTED_EPISODES` denotes an estimate from older or mixed incident
history. A joined in-flight reader receives the completed shared result rather
than a replay of the owner's intermediate frames.

[Dashboard reads](Dashboard-Reads) explains request coalescing, admission limits,
deadlines and cache freshness. The
[window-summary contract](https://github.com/brentjColoS/ColoradoTrafficTracker/blob/main/docs/dashboard-window-summaries.md)
details travel fallbacks and the incident-history seam.

## Interpretation and source

Use observation timestamps to judge traffic freshness and `fetchedAt` for the
API cache's successful fetch time. [Data and interpretation](FAQ) explains
geographic coverage, source limits and aggregation, while
[Historical storage](Historical-Storage) explains identity and provenance.

The [traffic controller](https://github.com/brentjColoS/ColoradoTrafficTracker/blob/main/api-service/src/main/java/com/example/api_service/TrafficController.java)
and [window-summary controller](https://github.com/brentjColoS/ColoradoTrafficTracker/blob/main/api-service/src/main/java/com/example/api_service/DashboardWindowSummaryController.java)
are the request contracts in code.

[← Wiki home](Home) · [Development reference →](Local-Development)
