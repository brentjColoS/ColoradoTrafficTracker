# Corridor Map Imagery

The dashboard supports a terrain basemap from Tracestrack and an aerial imagery
layer from USGS. Neither layer depicts current traffic conditions. Traffic
geometry, flow colors and incident markers are separate overlays.

The README uses one reviewed capture of the About the Data terrain backdrop,
with its corridor paths and attribution retained. Its moving bubbles are drawn
separately. Background refresh is manual and rare; the 15-minute publisher reads
stored traffic data without requesting map tiles. Capture details and coordinate
bounds are in `operations/portfolio/assets/map-base.json`; the
[publisher guide](../operations/portfolio/README.md) records maintenance and
[third-party notices](../THIRD_PARTY_NOTICES.md) record reuse terms.

Keep Maps © Tracestrack and its source credits visible: OpenStreetMap
contributors, SRTM, GEBCO, SONNY's LiDAR DTM, NASADEM and ESA WorldCover.
[Tracestrack's terms](https://tracestrack.com/terms-of-service/) permit attributed
media reuse under CC BY 4.0. Do not bulk-fetch tiles or spoof request headers.

The USGS contract and dated imagery check below describe that layer independently
of traffic-source resolution.

## Service contract

- Service: [USGS Imagery Only](https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer)
- Tile template:
  `https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile/{z}/{y}/{x}`
- Projection: Web Mercator (`EPSG:3857`)
- Tile size: 256 by 256 pixels
- Supported display limit: zoom 16, approximately 2.39 projected meters per
  pixel and scale 1:9,028
- Browser access: the sampled tile response included
  `Access-Control-Allow-Origin: *`
- Caching: the sampled tile response included `Cache-Control: max-age=86400`

The service metadata describes imagery ranging from six-inch to one-meter
source resolution, with most continental US coverage coming from NAIP. Its
published cache and source dates can lag current conditions. The interface must
call this layer **Imagery**, never live satellite or current traffic imagery.

## Corridor proof

Four zoom-16 tiles were inspected on September 20, 2026. The locations exercise
different roadway and terrain conditions rather than only the easiest segment.

| Corridor | Approximate location | Condition checked | Result |
| --- | --- | --- | --- |
| I-25 | 39.82747, -104.98124 | urban interchange and separated ramps | main carriageways and interchange geometry are clear |
| I-25 | 40.31525, -104.98042 | rural divided highway | both carriageways are distinct |
| I-70 | 39.63145, -106.06060 | mountain corridor near a geometry boundary | divided roadway is distinct from local roads |
| I-70 | 39.70106, -105.70825 | curved mountain alignment | roadway and median remain discernible |

These checks show that the imagery is suitable for orienting a viewer and for
making the two directional geometry lines understandable at close zoom. They do
not establish the accuracy, direction, or resolution of TomTom traffic data.
That remains gated on the separate flow-source proof.

No sampled tiles are checked into the repository. They remain provider-hosted
cache responses and are loaded only for the visible viewport.

## Attribution and use

The National Map describes its map services and data as free and public domain
and requests the following acknowledgment:

> Map services and data available from U.S. Geological Survey, National
> Geospatial Program.

Keep that acknowledgment visible in the map attribution control. Also retain
the service's source credit where practical: `USDA, USGS The National Map:
Orthoimagery.` Road geometry displayed above the imagery requires the separate
`© OpenStreetMap contributors` attribution documented in
`docs/corridor-geometry-sources.md`.

## Integration guardrails

- Load raster tiles directly from the documented USGS endpoint; do not add a
  tile proxy or local image archive for the initial release.
- Let the browser and upstream service cache tiles normally. Do not prefetch a
  corridor or request tiles outside the current viewport.
- Limit the map to zoom 16. Higher nominal cache levels are not part of the
  service's declared visible scale and must not be treated as extra detail.
- Keep a neutral route-outline fallback when imagery is unavailable. A basemap
  failure must not hide the incident table, traffic state, or explanation.
- Do not use imagery pixels to infer traffic, incidents, roadway direction, or
  current conditions.
- Recheck service metadata, terms and representative tiles when changing a layer
  or its supported zoom range.

## Original prototype decision

USGS imagery was accepted for the focused map prototype. The current renderer's
layer selection and fallback behavior are described in the
[MapLibre renderer guide](maplibre-renderer.md).
