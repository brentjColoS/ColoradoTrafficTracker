# Corridor Map Imagery

The corridor-map experiment uses USGS The National Map Imagery Only as its
initial aerial-photo backdrop. This choice adds no TomTom requests, exposes no
provider key, and does not require a server-side tile proxy.

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
- Recheck the service metadata, terms, and representative corridor tiles before
  promoting the experiment beyond its development branch.

## Decision

USGS imagery is accepted for the focused map prototype. A paid imagery provider
is not justified unless the experimental UI uncovers an availability,
legibility, or mobile-performance problem that the neutral fallback cannot
handle.
