create table traffic_flow_cell_hourly (
    corridor varchar(16) not null,
    cell_id varchar(64) not null,
    direction varchar(16) not null,
    hour_start timestamptz not null,
    start_mile_marker double precision not null,
    end_mile_marker double precision not null,
    source_zoom_min integer not null,
    source_zoom_max integer not null,
    observation_count integer not null,
    avg_speed_mph double precision not null,
    min_speed_mph double precision not null,
    max_speed_mph double precision not null,
    full_cell_observation_count integer not null,
    partial_cell_observation_count integer not null,
    closure_observation_count integer not null,
    min_finest_source_span_miles double precision not null,
    avg_length_weighted_source_span_miles double precision not null,
    max_coarsest_source_span_miles double precision not null,
    first_observed_at timestamptz not null,
    last_observed_at timestamptz not null,
    updated_at timestamptz not null default now(),
    primary key (corridor, cell_id, direction, hour_start),
    constraint traffic_flow_cell_hourly_marker_check
        check (end_mile_marker > start_mile_marker),
    constraint traffic_flow_cell_hourly_zoom_check
        check (
            source_zoom_min between 0 and 22
            and source_zoom_max between source_zoom_min and 22
        ),
    constraint traffic_flow_cell_hourly_observation_count_check
        check (
            observation_count > 0
            and full_cell_observation_count >= 0
            and partial_cell_observation_count >= 0
            and full_cell_observation_count + partial_cell_observation_count = observation_count
            and closure_observation_count between 0 and observation_count
        ),
    constraint traffic_flow_cell_hourly_speed_check
        check (
            min_speed_mph >= 0
            and avg_speed_mph + 0.000000001 >= min_speed_mph
            and avg_speed_mph <= max_speed_mph + 0.000000001
        ),
    constraint traffic_flow_cell_hourly_resolution_check
        check (
            min_finest_source_span_miles >= 0
            and avg_length_weighted_source_span_miles + 0.000000001
                >= min_finest_source_span_miles
            and avg_length_weighted_source_span_miles
                <= max_coarsest_source_span_miles + 0.000000001
        ),
    constraint traffic_flow_cell_hourly_time_check
        check (
            first_observed_at between hour_start and hour_start + interval '1 hour'
            and last_observed_at between first_observed_at and hour_start + interval '1 hour'
        )
);

create index idx_traffic_flow_cell_hourly_corridor_hour
    on traffic_flow_cell_hourly (corridor, hour_start desc);

comment on table traffic_flow_cell_hourly is
    'Durable hourly half-mile flow summaries. Rows have no automatic time-based deletion.';
