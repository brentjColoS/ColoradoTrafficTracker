# Corridor maps

The dashboard's maps read configured corridor geometry, retained traffic and
durable incident events. This page replaces the completed reconstruction plan;
its original investigation and delivery records are preserved separately.

## Current behavior

- I-25 covers MM 208–271. I-70 covers MM 206–274, including the Denver approach.
- Current local flow is a half-mile read model derived from provider paths.
  Current snapshots are replaced in place; historical map cells are hourly.
- Combined-direction values do not establish independent measurements in each
  carriageway. Source span and coverage metadata explain the supported detail.
- CDOT reports must overlap the configured corridor and mile-marker range.
  Geometry improves placement after that hard gate; it does not expand coverage.
- A basemap failure leaves the road outlines and other traffic information
  available. Background imagery is geographic context, not a traffic reading.

The [Data and interpretation wiki page](https://github.com/brentjColoS/ColoradoTrafficTracker/wiki/FAQ)
explains these distinctions for readers of the product. The
[About the Data page](https://coloradotraffictracker.net/dashboard/data.html)
shows the monitored corridors.

## Maintained references

- [Geometry, anchors and placement sources](corridor-geometry-sources.md)
- [Basemaps and attribution](corridor-map-imagery.md)
- [Data-history boundaries](data-history-coverage.md)
- [Pinned map renderer](maplibre-renderer.md)
- [Incident presentation](incident-presentation.md)
- [Experimental delivery boundary](experimental-delivery-workflow.md)

The README uses a reviewed capture of the same background and road geometry,
with independently generated travel-time bubbles. Its
[publisher](../operations/portfolio/README.md) refreshes estimates without
requesting map tiles on each update.
