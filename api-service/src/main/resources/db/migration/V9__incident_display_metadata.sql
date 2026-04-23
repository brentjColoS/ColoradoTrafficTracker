alter table traffic_incident
    add column if not exists incident_description text;

alter table traffic_incident_archive
    add column if not exists incident_description text;

drop view if exists traffic_incident_hotspot;
drop view if exists traffic_incident_all;

create view traffic_incident_all as
select
    i.id as history_id,
    i.id as incident_ref_id,
    i.sample_id as sample_ref_id,
    i.corridor,
    i.road_number,
    i.icon_category,
    i.incident_description,
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
    a.incident_description,
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

create view traffic_incident_hotspot as
select
    corridor,
    coalesce(travel_direction, '?') as travel_direction,
    cast(floor(closest_mile_marker) as integer) as mile_marker_band,
    count(*) as incident_count,
    avg(delay_seconds) as avg_delay_seconds,
    max(delay_seconds) as max_delay_seconds,
    min(polled_at) as first_seen_at,
    max(polled_at) as last_seen_at,
    sum(case when is_archived then 1 else 0 end) as archived_incident_count
from traffic_incident_all
group by
    corridor,
    coalesce(travel_direction, '?'),
    cast(floor(closest_mile_marker) as integer);
