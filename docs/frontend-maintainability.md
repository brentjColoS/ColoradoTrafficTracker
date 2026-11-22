# Frontend ownership

The browser uses deferred classic scripts with explicit factories and inputs.
The dashboard coordinates them; numerical models, rendering, transport and
presentation have separate owners. Modules load without starting requests.

## Module boundaries

| Owner | Responsibility |
| --- | --- |
| `dashboard.js` | Screen initialization, controls, live snapshots and selected view state. |
| `dashboard-transport.js` | Bounded dispatch, shared request budget, cancellation and cooldown. |
| `dashboard-history.js` | Retained anchors, request keys, accepted windows, retry state and bounded caches. |
| `dashboard-continuous.js` | Adjacent chunks, prepared series, raster reuse and continuous navigation. |
| `dashboard-series.js` | Observation normalization, smoothing, gaps, baselines, zones and domains. |
| `dashboard-chart-axis.js` | Viewer-time ticks and bounded calendar-transition caching. |
| `dashboard-chart-painter.js` | Canvas marks and geometry from an explicit paint frame. |
| `dashboard-incident-model.js` | Legacy conversion, identity, aggregation and lifecycle rules. |
| `dashboard-incident-table.js` | Rows, source/detail disclosures and incident status/time presentation. |
| `corridor-map-data.js` | Geometry, marker interpolation, flow cells, hotspots and GeoJSON preparation. |
| `corridor-map-style.js` | Initial MapLibre style and layer definitions. |
| `corridor-map.js` | Renderer lifecycle, interactions, markers, popups and theme changes. |
| `browser-theme.js` | Stored/device preference, persistence and accessible toggle labels. |
| `information-api.js` | API explorer presets, bounded reads, clipboard and response presentation. |
| `information-data.js` | Data-page daily reads and retained-day estimates; numerical helpers remain independent of DOM. |
| `information-pages.js` | Shared information-page effects and System status/heartbeat lifecycle. |

Load dependencies before consumers in `index.html`. The served application
bundles those scripts in source order; the standalone fixture page retains its
individual script references. Change served asset keys with their owning files.
The VM fixtures load the same dependency modules.

Factories receive explicit adapters and values instead of reaching back into
their coordinator. The incident table receives availability, focus and expansion
state. The painter receives a [paint frame](dashboard-chart-frame-contract.md),
series, palette and canvas adapters; it cannot request data or change navigation.

## Stylesheet ownership

| Owner | Scope |
| --- | --- |
| `dashboard.css` | Shared theme/navigation/accessibility defaults and dashboard-specific controls, charts, incidents, maps and signs. |
| `information.css` | Shared information layout and System/Data/API components. |
| `flow-diagram.css`, `health-panel.css` | Their standalone illustration components. |

Keep page-specific rules near their owners and theme values in the shared shell.
Matching values in unrelated components do not require a shared selector.
Retain the plain background fallback before `color-mix()`. Responsive, focus,
animation and reduced-motion cascade order affect behavior and require review.

Theme handling preserves page-specific behavior when storage fails or the device
preference changes. Information controllers receive an API-base resolver and
start only when initialized on the matching page.

## Changing and verifying behavior

Choose the owner of the behavior before editing. For example, the series model
owns the ninety-minute gap rule: exactly ninety minutes stays connected, a longer
gap starts a segment, and an invalid point breaks the line. The painter displays
that result. A regression should assert these boundaries through the model's
public behavior, including repeated speeds at different timestamps.

Run the nearest suite first, then the complete dashboard runner:

```sh
node --test scripts/tests/dashboard/series-and-zones.cjs
node --test scripts/tests/dashboard.test.cjs
```

Pure-model checks do not establish script ordering, browser startup, HTTP behavior
or visual equivalence. Use the [browser guide](browser-testing.md) for packaged
application checks and both-theme, mobile, failure and reduced-motion scenes.
The [CI reference](ci-cd-pipeline.md) records the required gates.

## Design tradeoffs

Explicit boundaries expose coupling and make focused tests possible. They do
not eliminate the complexity of timezones, missing observations, cancellation,
archive access or map lifecycle. Keep those guarantees while simplifying their
implementation. Further extraction should make a responsibility easier to
understand or test; a wrapper with more inputs than useful behavior adds little.

The [wiki](https://github.com/brentjColoS/ColoradoTrafficTracker/wiki/Architecture)
explains collection and storage decisions. This guide owns browser responsibilities
and verification rather than repeating those backend walkthroughs.
