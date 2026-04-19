alter table corridor_ref
    add column if not exists mile_marker_anchors_json text;

alter table traffic_incident
    add column if not exists mile_marker_method varchar(64),
    add column if not exists mile_marker_confidence double precision,
    add column if not exists distance_to_corridor_meters double precision;

alter table traffic_incident_archive
    add column if not exists mile_marker_method varchar(64),
    add column if not exists mile_marker_confidence double precision,
    add column if not exists distance_to_corridor_meters double precision;

create or replace view traffic_incident_all as
select
    i.id as history_id,
    i.id as incident_ref_id,
    i.sample_id as sample_ref_id,
    i.corridor,
    i.road_number,
    i.icon_category,
    i.delay_seconds,
    i.geometry_type,
    i.geometry_json,
    i.travel_direction,
    i.closest_mile_marker,
    i.mile_marker_method,
    i.mile_marker_confidence,
    i.distance_to_corridor_meters,
    i.location_label,
    i.centroid_lat,
    i.centroid_lon,
    i.polled_at,
    i.normalized_at,
    cast(null as timestamptz) as archived_at,
    false as is_archived
from traffic_incident i
union all
select
    -a.source_id as history_id,
    a.source_id as incident_ref_id,
    a.sample_source_id as sample_ref_id,
    a.corridor,
    a.road_number,
    a.icon_category,
    a.delay_seconds,
    a.geometry_type,
    a.geometry_json,
    a.travel_direction,
    a.closest_mile_marker,
    a.mile_marker_method,
    a.mile_marker_confidence,
    a.distance_to_corridor_meters,
    a.location_label,
    a.centroid_lat,
    a.centroid_lon,
    a.polled_at,
    a.normalized_at,
    a.archived_at,
    true as is_archived
from traffic_incident_archive a;
