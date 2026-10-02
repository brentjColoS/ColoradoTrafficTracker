# Corridor Geometry Sources

Configured corridor geometries are derived from OpenStreetMap route relations and constrained to the monitored corridor windows.

| Corridor | Source relation | Direction used | Monitored extent | Generated resource |
| --- | --- | --- | --- | --- |
| I25 | OpenStreetMap relation `2333677` | I-25 South | CDOT MM 270 to MM 208 | `routes-service/src/main/resources/routes/i25.geojson` |
| I70 | OpenStreetMap relation `6894122` | I-70 East | CDOT MM 206 to MM 274 at I-25 | `routes-service/src/main/resources/routes/i70.geojson` |

The configured resources replace TomTom bbox-corner routing for map display, mile-marker calibration, and incident snapping. Bboxes remain useful for tile and incident search coverage, but should not be treated as route geometry.

## Directional catalog

The route service also includes versioned two-carriageway catalogs under
`routes-service/src/main/resources/routes/directional/`. I-25 continues to use
version 1. I-70 version 1 remains checked in as the former MM 206–259 catalog;
the live endpoint uses version 2 for the MM 206–274 extent.

| Corridor | Direction | OSM relation | Pinned version | Source timestamp |
| --- | --- | --- | --- | --- |
| I25 | Northbound | `2333676` | `266` | 2026-04-30 20:54:01 UTC |
| I25 | Southbound | `2333677` | `261` | 2026-04-30 20:54:01 UTC |
| I70 | Eastbound | `6894122` | `219` | 2026-07-07 04:04:17 UTC |
| I70 | Westbound | `84533` | `352` | 2026-07-07 04:04:17 UTC |

The MM 274 endpoint and the added MM 260 and MM 270 anchors come from CDOT's
public `070A` highway-milepoint data. MM 274 is the I-25 interchange boundary;
the configured bbox already covered that location and did not need expansion.

The source relations are maintained by OpenStreetMap contributors under the
[Open Database License](https://www.openstreetmap.org/copyright). Keep the
`© OpenStreetMap contributors` attribution anywhere this geometry is displayed.

The catalog is available through the route service at:

```text
GET /routes/corridors/I25/directions
GET /routes/corridors/I70/directions
```

Each endpoint returns `application/geo+json` with the two direction features
and a one-day public cache lifetime. `I-25` and `I-70` are accepted aliases.
Unknown corridors return `404`; the existing `/routes/corridors` response is
unchanged.

Ingest tests each decoded TomTom `one_side` path against both carriageways. It
adds a directional flow-cell row only when at least 80 percent of the path is
inside the route buffer, its mean match distance is at most 40 meters, and the
winning carriageway is at least 5 meters closer than the alternative. Full-road,
equidistant, incomplete-catalog, and otherwise ambiguous evidence remains
combined. Matching reuses the normal flow poll and adds no TomTom requests.

### Rebuild

Download the current relation snapshots from the official OSM API into a
temporary directory. The raw snapshots are build inputs and are not retained in
the repository. OSM's API does not provide a historical relation version through
the `/full` endpoint, so the importer verifies that each downloaded relation's
version and timestamp still match the pinned catalog before writing anything.
If one changes, review the new source and create a new geometry version instead
of weakening the check.

```bash
mkdir -p /tmp/ctt-directional-osm
curl -fsSL https://api.openstreetmap.org/api/0.6/relation/2333676/full -o /tmp/ctt-directional-osm/ctt-i25-north.osm
curl -fsSL https://api.openstreetmap.org/api/0.6/relation/2333677/full -o /tmp/ctt-directional-osm/ctt-i25-south.osm
curl -fsSL https://api.openstreetmap.org/api/0.6/relation/6894122/full -o /tmp/ctt-directional-osm/ctt-i70-east.osm
curl -fsSL https://api.openstreetmap.org/api/0.6/relation/84533/full -o /tmp/ctt-directional-osm/ctt-i70-west.osm

./scripts/geometry/extend-i70-reference.py \
  --source /tmp/ctt-directional-osm/ctt-i70-east.osm

./scripts/geometry/build-directional-corridors.py \
  --source-dir /tmp/ctt-directional-osm \
  --corridor I70
```

The reference extender retains the existing MM 206–259 coordinates byte for
byte and finds the continuous relation path from that boundary to MM 274. The
directional importer uses relation topology rather than member ordering, which
keeps it reliable around interchange connector members. Both tools fail if a
pinned relation version or timestamp changes, an endpoint is more than 250
meters from the monitored reference, the length differs by more than 0.25 mile,
or any generated point is more than 250 meters from that reference. The
directional importer writes a machine-readable `qa-report.json` beside each
versioned catalog.

### Version 1 QA result

| Corridor | Direction | Coordinates | Length | Median / p95 reference distance | Maximum distance | Endpoint gaps |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| I25 | Northbound | 1,031 | 61.97 mi | 29.1 / 62.1 m | 165.5 m | 51.7 / 27.5 m |
| I25 | Southbound | 959 | 61.96 mi | 0.0 / 0.0 m | 6.8 m | 0.0 / 0.0 m |
| I70 | Eastbound | 1,469 | 52.88 mi | 0.0 / 0.1 m | 0.1 m | 0.0 / 0.1 m |
| I70 | Westbound | 1,707 | 52.97 mi | 18.4 / 28.1 m | 187.4 m | 187.4 / 37.8 m |

The larger I25 northbound and I70 westbound distances remain in the catalog;
the importer does not offset or collapse the two sides of the road. The I70
westbound difference reaches its maximum at the monitored boundary. These
figures establish geometric plausibility; individual TomTom path direction is
still accepted only through the matching thresholds above.

### I-70 version 2 QA result

| Direction | Coordinates | Length | Median / p95 reference distance | Maximum distance | Endpoint gaps |
| --- | ---: | ---: | ---: | ---: | ---: |
| Eastbound | 1,775 | 67.63 mi | 0.0 / 0.1 m | 0.1 m | 0.0 / 0.0 m |
| Westbound | 2,059 | 67.80 mi | 18.7 / 31.0 m | 187.4 m | 187.4 / 19.0 m |

Version 2 keeps the full prior eastbound reference unchanged through MM 259,
then adds the Golden and west-Denver segment through the I-25 interchange. The
larger westbound separation remains at the existing western boundary, not in
the newly added section.
