create table traffic_flow_cell_snapshot_current (
    corridor varchar(16) primary key,
    observed_at timestamptz not null,
    source_zoom integer not null,
    status varchar(40) not null,
    detail text not null,
    cell_size_miles double precision not null,
    total_cell_count integer not null,
    supported_cell_count integer not null,
    unique_source_path_count integer not null,
    duplicate_source_path_count integer not null,
    stored_at timestamptz not null default now(),
    constraint traffic_flow_cell_snapshot_current_zoom_check
        check (source_zoom between 0 and 22),
    constraint traffic_flow_cell_snapshot_current_cell_size_check
        check (cell_size_miles > 0),
    constraint traffic_flow_cell_snapshot_current_counts_check
        check (
            total_cell_count >= 0
            and supported_cell_count between 0 and total_cell_count
            and unique_source_path_count >= 0
            and duplicate_source_path_count >= 0
        )
);

create table traffic_flow_cell_current (
    corridor varchar(16) not null references traffic_flow_cell_snapshot_current(corridor)
        on delete cascade,
    cell_id varchar(64) not null,
    observed_at timestamptz not null,
    start_mile_marker double precision not null,
    end_mile_marker double precision not null,
    direction varchar(16) not null,
    speed_mph double precision not null,
    source_path_count integer not null,
    one_side_source_count integer not null,
    full_source_count integer not null,
    unknown_coverage_source_count integer not null,
    closure_evidence varchar(32) not null,
    covered_marker_miles double precision not null,
    finest_source_span_miles double precision not null,
    length_weighted_source_span_miles double precision not null,
    coarsest_source_span_miles double precision not null,
    coarsest_source_start_mile_marker double precision not null,
    coarsest_source_end_mile_marker double precision not null,
    quality varchar(24) not null,
    primary key (corridor, cell_id, direction),
    constraint traffic_flow_cell_current_marker_check
        check (end_mile_marker > start_mile_marker),
    constraint traffic_flow_cell_current_speed_check
        check (speed_mph >= 0),
    constraint traffic_flow_cell_current_counts_check
        check (
            source_path_count > 0
            and one_side_source_count >= 0
            and full_source_count >= 0
            and unknown_coverage_source_count >= 0
        ),
    constraint traffic_flow_cell_current_coverage_check
        check (
            covered_marker_miles >= 0
            and finest_source_span_miles >= 0
            and length_weighted_source_span_miles >= 0
            and coarsest_source_span_miles >= 0
        )
);

comment on table traffic_flow_cell_snapshot_current is
    'Latest coherent half-mile flow-cell snapshot metadata for each monitored corridor.';

comment on table traffic_flow_cell_current is
    'Latest supported half-mile flow cells. Rows are replaced in place and are not historical samples.';
