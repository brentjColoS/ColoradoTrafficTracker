# Corridor Geometry Sources

Configured corridor geometries are derived from OpenStreetMap route relations and constrained to the monitored corridor windows.

| Corridor | Source relation | Direction used | Monitored extent | Generated resource |
| --- | --- | --- | --- | --- |
| I25 | OpenStreetMap relation `2333677` | I-25 South | CDOT MM 270 to MM 208 | `routes-service/src/main/resources/routes/i25.geojson` |
| I70 | OpenStreetMap relation `6894122` | I-70 East | CDOT MM 206 to MM 259 | `routes-service/src/main/resources/routes/i70.geojson` |

The configured resources replace TomTom bbox-corner routing for map display, mile-marker calibration, and incident snapping. Bboxes remain useful for tile and incident search coverage, but should not be treated as route geometry.
