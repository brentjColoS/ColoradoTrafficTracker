create table if not exists corridor_ref (
    code varchar(64) primary key,
    display_name varchar(255) not null,
    road_number varchar(64),
    primary_direction varchar(16),
    secondary_direction varchar(16),
    start_mile_marker double precision,
    end_mile_marker double precision,
    bbox varchar(255) not null,
    center_lat double precision,
    center_lon double precision,
    geometry_json text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create index if not exists idx_corridor_ref_road_number
    on corridor_ref (road_number);

alter table traffic_sample
    add column if not exists source_mode varchar(32) not null default 'unknown',
    add column if not exists speed_sample_count integer,
    add column if not exists speed_stddev double precision,
    add column if not exists p10_speed double precision,
    add column if not exists p50_speed double precision,
    add column if not exists p90_speed double precision,
    add column if not exists incident_count integer not null default 0,
    add column if not exists ingested_at timestamptz not null default now();

alter table traffic_incident
    add column if not exists travel_direction varchar(16),
    add column if not exists closest_mile_marker double precision,
    add column if not exists location_label varchar(255),
    add column if not exists centroid_lat double precision,
    add column if not exists centroid_lon double precision;

create index if not exists idx_traffic_incident_corridor_direction_mile_marker
    on traffic_incident (corridor, travel_direction, closest_mile_marker, polled_at desc);

alter table traffic_sample_archive
    add column if not exists source_mode varchar(32) not null default 'unknown',
    add column if not exists speed_sample_count integer,
    add column if not exists speed_stddev double precision,
    add column if not exists p10_speed double precision,
    add column if not exists p50_speed double precision,
    add column if not exists p90_speed double precision,
    add column if not exists incident_count integer not null default 0,
    add column if not exists ingested_at timestamptz not null default now();
