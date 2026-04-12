create table if not exists traffic_incident_archive (
    id bigserial primary key,
    source_id bigint unique,
    sample_source_id bigint not null,
    corridor varchar(255) not null,
    road_number varchar(64),
    icon_category integer,
    delay_seconds integer,
    geometry_type varchar(64),
    geometry_json text,
    travel_direction varchar(16),
    closest_mile_marker double precision,
    location_label varchar(255),
    centroid_lat double precision,
    centroid_lon double precision,
    polled_at timestamptz not null,
    normalized_at timestamptz not null,
    archived_at timestamptz not null
);

create index if not exists idx_traffic_incident_archive_corridor_polled_at
    on traffic_incident_archive (corridor, polled_at desc);

create index if not exists idx_traffic_incident_archive_corridor_direction_mile_marker
    on traffic_incident_archive (corridor, travel_direction, closest_mile_marker, polled_at desc);

create or replace view traffic_sample_all as
select
    s.id as history_id,
    s.id as sample_ref_id,
    s.corridor,
    s.avg_current_speed,
    s.avg_freeflow_speed,
    s.min_current_speed,
    s.confidence,
    s.source_mode,
    s.speed_sample_count,
    s.speed_stddev,
    s.p10_speed,
    s.p50_speed,
    s.p90_speed,
    s.incident_count,
    s.incidents_json,
    s.polled_at,
    s.ingested_at,
    cast(null as timestamptz) as archived_at,
    false as is_archived
from traffic_sample s
union all
select
    -a.source_id as history_id,
    a.source_id as sample_ref_id,
    a.corridor,
    a.avg_current_speed,
    a.avg_freeflow_speed,
    a.min_current_speed,
    a.confidence,
    a.source_mode,
    a.speed_sample_count,
    a.speed_stddev,
    a.p10_speed,
    a.p50_speed,
    a.p90_speed,
    a.incident_count,
    a.incidents_json,
    a.polled_at,
    a.ingested_at,
    a.archived_at,
    true as is_archived
from traffic_sample_archive a;

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
    a.location_label,
    a.centroid_lat,
    a.centroid_lon,
    a.polled_at,
    a.normalized_at,
    a.archived_at,
    true as is_archived
from traffic_incident_archive a;
