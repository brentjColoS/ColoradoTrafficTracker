alter table traffic_sample
    add column if not exists validation_requested_points integer,
    add column if not exists validation_returned_points integer,
    add column if not exists validation_coverage_ratio double precision,
    add column if not exists validation_used boolean not null default false,
    add column if not exists degraded boolean not null default false,
    add column if not exists degraded_reason varchar(255);

alter table traffic_sample_archive
    add column if not exists validation_requested_points integer,
    add column if not exists validation_returned_points integer,
    add column if not exists validation_coverage_ratio double precision,
    add column if not exists validation_used boolean not null default false,
    add column if not exists degraded boolean not null default false,
    add column if not exists degraded_reason varchar(255);

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
    s.validation_requested_points,
    s.validation_returned_points,
    s.validation_coverage_ratio,
    s.validation_used,
    s.degraded,
    s.degraded_reason,
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
    a.validation_requested_points,
    a.validation_returned_points,
    a.validation_coverage_ratio,
    a.validation_used,
    a.degraded,
    a.degraded_reason,
    a.polled_at,
    a.ingested_at,
    a.archived_at,
    true as is_archived
from traffic_sample_archive a;
