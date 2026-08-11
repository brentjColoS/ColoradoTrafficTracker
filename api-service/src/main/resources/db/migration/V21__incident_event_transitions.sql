alter table traffic_incident_event_corridor
    add column if not exists latest_match_hash varchar(64);

create table if not exists traffic_incident_event_transition (
    id bigserial primary key,
    event_id bigint not null references traffic_incident_event(id) on delete cascade,
    occurred_at timestamptz not null,
    transition_type varchar(32) not null,
    active boolean not null,
    previous_payload_hash varchar(64),
    payload_hash varchar(64) not null,
    source_updated_at timestamptz,
    source_status varchar(128),
    normalized_status varchar(64) not null,
    raw_event_json text not null,
    created_at timestamptz not null default now(),
    constraint chk_traffic_incident_event_transition_type
        check (transition_type in ('BASELINE', 'FIRST_SEEN', 'PAYLOAD_CHANGED', 'INACTIVE', 'REACTIVATED')),
    constraint uq_traffic_incident_event_transition
        unique (event_id, occurred_at, transition_type)
);

create index if not exists idx_traffic_incident_event_transition_event_time
    on traffic_incident_event_transition (event_id, occurred_at desc);

create table if not exists traffic_incident_event_corridor_transition (
    id bigserial primary key,
    event_id bigint not null references traffic_incident_event(id) on delete cascade,
    corridor varchar(255) not null,
    occurred_at timestamptz not null,
    transition_type varchar(32) not null,
    active boolean not null,
    match_hash varchar(64),
    road_number varchar(64),
    travel_direction varchar(64),
    closest_mile_marker double precision,
    mile_marker_method varchar(64),
    mile_marker_confidence double precision,
    distance_to_corridor_meters double precision,
    location_label varchar(255),
    centroid_lat double precision,
    centroid_lon double precision,
    created_at timestamptz not null default now(),
    constraint chk_traffic_incident_event_corridor_transition_type
        check (transition_type in ('BASELINE', 'FIRST_MATCHED', 'MATCH_CHANGED', 'UNMATCHED', 'REMATCHED')),
    constraint uq_traffic_incident_event_corridor_transition
        unique (event_id, corridor, occurred_at, transition_type)
);

create index if not exists idx_traffic_incident_event_corridor_transition_corridor_time
    on traffic_incident_event_corridor_transition (corridor, occurred_at desc);

insert into traffic_incident_event_transition (
    event_id,
    occurred_at,
    transition_type,
    active,
    payload_hash,
    source_updated_at,
    source_status,
    normalized_status,
    raw_event_json
)
select
    id,
    now(),
    'BASELINE',
    active,
    latest_payload_hash,
    source_updated_at,
    source_status,
    normalized_status,
    raw_event_json
from traffic_incident_event
on conflict (event_id, occurred_at, transition_type) do nothing;

insert into traffic_incident_event_corridor_transition (
    event_id,
    corridor,
    occurred_at,
    transition_type,
    active,
    road_number,
    travel_direction,
    closest_mile_marker,
    mile_marker_method,
    mile_marker_confidence,
    distance_to_corridor_meters,
    location_label,
    centroid_lat,
    centroid_lon
)
select
    event_id,
    corridor,
    now(),
    'BASELINE',
    active,
    road_number,
    travel_direction,
    closest_mile_marker,
    mile_marker_method,
    mile_marker_confidence,
    distance_to_corridor_meters,
    location_label,
    centroid_lat,
    centroid_lon
from traffic_incident_event_corridor
on conflict (event_id, corridor, occurred_at, transition_type) do nothing;
