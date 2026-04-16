create table if not exists traffic_provider_guard_status (
    provider_name varchar(64) primary key,
    state varchar(32) not null,
    halted boolean not null default false,
    failure_code varchar(64),
    message text,
    details_json text,
    consecutive_null_cycles integer not null default 0,
    last_checked_at timestamptz not null,
    last_success_at timestamptz,
    last_failure_at timestamptz,
    shutdown_triggered_at timestamptz
);
