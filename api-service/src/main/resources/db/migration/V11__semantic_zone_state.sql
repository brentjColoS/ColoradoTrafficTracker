alter table traffic_sample
    add column if not exists speed_state_signature varchar(64),
    add column if not exists semantic_flow_signature varchar(64),
    add column if not exists localized_slowdown boolean not null default false,
    add column if not exists localized_slowdown_note varchar(255);

alter table traffic_sample_archive
    add column if not exists speed_state_signature varchar(64),
    add column if not exists semantic_flow_signature varchar(64),
    add column if not exists localized_slowdown boolean not null default false,
    add column if not exists localized_slowdown_note varchar(255);

create table if not exists traffic_speed_zone_sample (
    id bigserial primary key,
    sample_id bigint not null references traffic_sample(id) on delete cascade,
    corridor varchar(255) not null,
    zone_key varchar(128) not null,
    zone_order integer not null,
    zone_label varchar(128) not null,
    zone_description varchar(255),
    start_mile_marker double precision not null,
    end_mile_marker double precision not null,
    posted_speed_mph integer not null,
    avg_current_speed double precision,
    min_current_speed double precision,
    speed_stddev double precision,
    p10_speed double precision,
    p50_speed double precision,
    p90_speed double precision,
    speed_sample_count integer not null default 0,
    speed_state_signature varchar(64),
    polled_at timestamptz not null,
    ingested_at timestamptz not null default now()
);

create index if not exists idx_traffic_speed_zone_sample_corridor_polled_at
    on traffic_speed_zone_sample (corridor, polled_at desc);

create index if not exists idx_traffic_speed_zone_sample_sample
    on traffic_speed_zone_sample (sample_id);

drop view if exists traffic_corridor_hourly_rollup;
drop view if exists traffic_sample_all;

create view traffic_sample_all as
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
    s.speed_state_signature,
    s.semantic_flow_signature,
    s.localized_slowdown,
    s.localized_slowdown_note,
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
    a.speed_state_signature,
    a.semantic_flow_signature,
    a.localized_slowdown,
    a.localized_slowdown_note,
    a.polled_at,
    a.ingested_at,
    a.archived_at,
    true as is_archived
from traffic_sample_archive a;

create view traffic_corridor_hourly_rollup as
select
    corridor,
    date_trunc('hour', polled_at) as bucket_start,
    count(*) as sample_count,
    avg(avg_current_speed) as avg_current_speed,
    avg(avg_freeflow_speed) as avg_freeflow_speed,
    min(min_current_speed) as min_current_speed,
    avg(confidence) as avg_confidence,
    avg(speed_stddev) as avg_speed_stddev,
    avg(p50_speed) as avg_p50_speed,
    avg(p90_speed) as avg_p90_speed,
    sum(incident_count) as total_incidents,
    sum(case when is_archived then 1 else 0 end) as archived_sample_count
from traffic_sample_all
group by corridor, date_trunc('hour', polled_at);
