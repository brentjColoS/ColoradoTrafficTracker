alter table traffic_provider_guard_status
    add column if not exists consecutive_stale_cycles integer not null default 0;

alter table traffic_provider_guard_status
    add column if not exists last_cycle_signature varchar(128);
