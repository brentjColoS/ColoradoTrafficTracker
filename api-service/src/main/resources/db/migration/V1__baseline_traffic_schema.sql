create table if not exists traffic_sample (
    id bigserial primary key,
    corridor varchar(255) not null,
    avg_current_speed double precision,
    avg_freeflow_speed double precision,
    min_current_speed double precision,
    confidence double precision,
    incidents_json text,
    polled_at timestamptz not null
);

create index if not exists idx_traffic_sample_corridor_polled_at
    on traffic_sample (corridor, polled_at desc);

create table if not exists traffic_incident (
    id bigserial primary key,
    sample_id bigint not null references traffic_sample(id) on delete cascade,
    corridor varchar(255) not null,
    road_number varchar(64),
    icon_category integer,
    delay_seconds integer,
    geometry_type varchar(64),
    geometry_json text,
    polled_at timestamptz not null,
    normalized_at timestamptz not null
);

create index if not exists idx_traffic_incident_corridor_polled_at
    on traffic_incident (corridor, polled_at desc);

create table if not exists traffic_sample_archive (
    id bigserial primary key,
    source_id bigint unique,
    corridor varchar(255) not null,
    avg_current_speed double precision,
    avg_freeflow_speed double precision,
    min_current_speed double precision,
    confidence double precision,
    incidents_json text,
    polled_at timestamptz not null,
    archived_at timestamptz not null
);

create index if not exists idx_traffic_sample_archive_corridor_polled_at
    on traffic_sample_archive (corridor, polled_at desc);
