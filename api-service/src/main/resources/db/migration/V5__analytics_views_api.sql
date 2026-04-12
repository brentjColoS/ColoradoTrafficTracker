create or replace view traffic_corridor_hourly_rollup as
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

create or replace view traffic_incident_hotspot as
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
