create table if not exists tomtom_account_reset_probe (
    id bigint generated always as identity primary key,
    account_id varchar(64) not null,
    probed_at timestamptz not null,
    outcome varchar(32) not null,
    http_status integer,
    provider_code varchar(96),
    constraint chk_tomtom_reset_probe_outcome check (
        outcome in (
            'AVAILABLE',
            'CREDITS_EXHAUSTED',
            'AUTH_FAILED',
            'RATE_LIMITED',
            'ERROR'
        )
    )
);

create index if not exists idx_tomtom_reset_probe_account_time
    on tomtom_account_reset_probe (account_id, probed_at desc);
