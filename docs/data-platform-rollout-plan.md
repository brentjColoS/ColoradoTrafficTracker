# Data Platform Rollout Plan

Status: implemented across the current schema, ingest flow, and read APIs. This document now serves as a delivery record and sequencing reference rather than a future-only plan.

This document turns the current data-storage assessment into an implementation plan that can be delivered in small, reviewable branches with human-sized commits.

## Goals

- Preserve the current app behavior while making the data model more analysis-ready.
- Support human-friendly location references using corridor, closest mile marker, and travel direction.
- Make the stored data more useful for map visualization and spatial browsing.
- Preserve history better so the database becomes a durable analytics asset, not only a live snapshot store.

## Design Principles

- Keep corridor-level summaries for the existing dashboard and APIs.
- Add richer metadata without forcing every caller to adopt it immediately.
- Prefer additive migrations first so we can ship incrementally and safely.
- Store both analyst-friendly attributes and map-friendly location attributes.
- Treat "where" as first-class data, especially for incidents and future segment-level observations.

## Branch Sequence

### 1. `topic/data-model-foundation`

Scope:

- Add a corridor dimension table for stable metadata.
- Add sample provenance and statistical context to `traffic_sample`.
- Add human-friendly location semantics to `traffic_incident`.
- Seed corridor metadata from the current route configuration.

Planned schema additions:

- `corridor_ref`
  - stable corridor code
  - display name
  - route number
  - primary directions
  - bounding box
  - optional map polyline/GeoJSON placeholder
- `traffic_sample`
  - `source_mode`
  - `speed_sample_count`
  - `speed_stddev`
  - `p10_speed`
  - `p50_speed`
  - `p90_speed`
  - `incident_count`
  - `ingested_at`
- `traffic_incident`
  - `travel_direction`
  - `closest_mile_marker`
  - `location_label`
  - `centroid_lat`
  - `centroid_lon`

Implementation notes:

- `location_label` should be human-readable, with a format like `I-25 northbound near MM 214.6`.
- Mile marker should be stored numerically so it remains sortable and analyzable.
- Direction should be stored as a normalized code such as `N`, `S`, `E`, or `W`, with a derived display label where needed.
- Coordinates should remain available even if the UI later prefers GeoJSON responses.

### 2. `topic/history-retention-analytics`

Scope:

- Preserve normalized incident history during archival.
- Make live and archived sample history queriable together.
- Avoid breaking existing current-history APIs.

Planned changes:

- Add `traffic_incident_archive`.
- Add a shared historical view, likely `traffic_sample_all`.
- Extend archive retention logic to copy normalized incidents as well as samples.

### 3. `topic/map-geometry-surface`

Scope:

- Make corridor and incident data easier to render on a map.
- Add map-oriented responses without replacing the current dashboard contract.

Planned changes:

- Store map-ready corridor geometry in a durable form.
- Add API responses for corridor geometry and incident map features.
- Prepare for PostGIS or, if deferred, keep GeoJSON/lat-lon fields normalized enough to migrate cleanly later.

### 4. `topic/analytics-views-api`

Scope:

- Add read models and views for richer analysis.
- Expose analyst-friendly endpoints over the improved schema.

Planned changes:

- SQL views or repository queries for:
  - long-history corridor trends
  - incident hotspots by corridor, mile marker band, and direction
  - corridor summary rollups
  - archive-inclusive history
- API endpoints tailored for dashboards and downstream analysis.

### 5. `topic/timeseries-optimization`

Scope:

- Use TimescaleDB where it adds clear value.

Planned changes:

- Convert sample and incident tables to hypertables where appropriate.
- Add compression and retention policies once archive behavior is stable.
- Add continuous aggregates for common time buckets like 5-minute and hourly summaries.

### 6. `topic/dashboard-consumers`

Scope:

- Upgrade the dashboard and any read-side consumers to use the richer model.

Planned changes:

- Show map-ready incident descriptions using corridor + direction + mile marker.
- Add richer historical context without breaking the simple current UX.
- Prepare the UI for spatial browsing and future route overlays.

## Commit Style

Each branch should land through small commits with a human-readable progression:

- `docs(data): outline rollout for analytics-ready traffic storage`
- `feat(db): add corridor dimension and richer sample metadata`
- `feat(ingest): persist sample provenance and incident location fields`
- `test(ingest): cover summary stats and location labeling`

## Initial Assumptions

- Corridor code remains the stable external identifier for now, for example `I25` and `I70`.
- Mile marker can be approximate at first if it is derived from geometry or bounding-box heuristics.
- Direction is more valuable than overfitting exact geometry too early, so we should normalize direction even before full spatial support arrives.
- Map support should begin with lat/lon and GeoJSON-friendly fields even if PostGIS lands in a later branch.
