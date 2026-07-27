create table if not exists traffic_scheduler_lease (
    lease_name varchar(128) primary key,
    owner_id varchar(64),
    lease_until timestamptz not null default timestamp with time zone '1970-01-01 00:00:00+00',
    next_run_at timestamptz not null default timestamp with time zone '1970-01-01 00:00:00+00',
    last_started_at timestamptz,
    last_finished_at timestamptz,
    updated_at timestamptz not null default now()
);

create index if not exists idx_traffic_scheduler_lease_next_run
    on traffic_scheduler_lease (next_run_at);
