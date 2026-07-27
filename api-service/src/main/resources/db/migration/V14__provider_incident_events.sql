create table if not exists traffic_incident_event (
    id bigserial primary key,
    provider varchar(64) not null,
    product varchar(128) not null,
    provider_event_id varchar(255) not null,
    source_status varchar(128),
    normalized_status varchar(64) not null,
    source_category varchar(128),
    normalized_category varchar(64),
    incident_description text,
    geometry_type varchar(64),
    geometry_json text,
    source_started_at timestamptz,
    source_ended_at timestamptz,
    source_updated_at timestamptz,
    first_seen_at timestamptz not null,
    last_seen_at timestamptz not null,
    active boolean not null default true,
    latest_payload_hash varchar(64) not null,
    raw_event_json text not null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint uq_traffic_incident_event_provider_id
        unique (provider, provider_event_id),
    constraint chk_traffic_incident_event_seen_range
        check (last_seen_at >= first_seen_at)
);

create index if not exists idx_traffic_incident_event_active_provider
    on traffic_incident_event (provider, product, active, last_seen_at desc);

create index if not exists idx_traffic_incident_event_source_updated
    on traffic_incident_event (source_updated_at desc);

create table if not exists traffic_incident_event_corridor (
    event_id bigint not null references traffic_incident_event(id) on delete cascade,
    corridor varchar(255) not null,
    road_number varchar(64),
    travel_direction varchar(64),
    closest_mile_marker double precision,
    mile_marker_method varchar(64),
    mile_marker_confidence double precision,
    distance_to_corridor_meters double precision,
    location_label varchar(255),
    centroid_lat double precision,
    centroid_lon double precision,
    first_matched_at timestamptz not null,
    last_matched_at timestamptz not null,
    active boolean not null default true,
    primary key (event_id, corridor),
    constraint chk_traffic_incident_event_corridor_seen_range
        check (last_matched_at >= first_matched_at)
);

create index if not exists idx_traffic_incident_event_corridor_active
    on traffic_incident_event_corridor (corridor, active, last_matched_at desc);

create table if not exists traffic_incident_event_observation (
    id bigserial primary key,
    event_id bigint not null references traffic_incident_event(id) on delete cascade,
    observed_at timestamptz not null,
    source_updated_at timestamptz,
    payload_hash varchar(64) not null,
    source_status varchar(128),
    normalized_status varchar(64) not null,
    raw_event_json text not null,
    created_at timestamptz not null default now(),
    constraint uq_traffic_incident_event_observation
        unique (event_id, payload_hash)
);

create index if not exists idx_traffic_incident_event_observation_event_time
    on traffic_incident_event_observation (event_id, observed_at desc);
