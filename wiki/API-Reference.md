![Colorado Traffic Tracker](https://raw.githubusercontent.com/brentjColoS/ColoradoTrafficTracker/main/docs/assets/ctt-wordmark.svg)

Use the [API explorer](https://coloradotraffictracker.net/dashboard/api.html)
to inspect stored data and current response shapes. This page explains the
boundaries behind those requests.

## Two read surfaces

The website's `/dashboard-api/` surface is public and read-only. The protected
`/api/` equivalent uses the application's API-key boundary. Neither surface
asks TomTom or CDOT to collect data on behalf of a page visitor.

The browser's optional basemap key belongs to the map configuration and its
provider restrictions. It is separate from credentials used by the collector.

## Follow an observation

| Read | Use |
| --- | --- |
| [`traffic/latest?corridor=I25`](https://coloradotraffictracker.net/dashboard-api/traffic/latest?corridor=I25) | Inspect a retained corridor observation and its source timestamp. |
| [`traffic/history?corridor=I25&windowMinutes=1440&limit=2000&includeIncidents=false`](https://coloradotraffictracker.net/dashboard-api/traffic/history?corridor=I25&windowMinutes=1440&limit=2000&includeIncidents=false) | Read compact speed history for a chart. |
| [`traffic/analytics/baselines?corridor=I25`](https://coloradotraffictracker.net/dashboard-api/traffic/analytics/baselines?corridor=I25) | Inspect matched profiles, source counts and historical variation. |
| [`traffic/map/corridors`](https://coloradotraffictracker.net/dashboard-api/traffic/map/corridors) | Read the configured road geometry and monitored extents. |

## Historical bounds matter

History reads include archived scalar observations. `asOf` selects an endpoint
for a historical request; `windowMinutes` selects the lookback. A full response
can hit its row limit, so a client that needs every observation must page back
and deduplicate the inclusive timestamp boundary. The compact speed-only
history limit is 2,000 rows, and an individual request is bounded to seven days.

The journal and calendar use original corridor observations. Larger dashboard
views can use hourly summaries, which are a different level of aggregation.
The [window-summary reference](https://github.com/brentjColoS/ColoradoTrafficTracker/blob/main/docs/dashboard-window-summaries.md)
explains those derived reads and their limits.

For implementation, start with the
[traffic controller](https://github.com/brentjColoS/ColoradoTrafficTracker/blob/main/api-service/src/main/java/com/example/api_service/TrafficController.java)
and [read-model notes](https://github.com/brentjColoS/ColoradoTrafficTracker/blob/main/docs/dashboard-read-models.md).
Source timestamps and coverage fields should travel with a chart rather than
being replaced by the time its page was rendered.
