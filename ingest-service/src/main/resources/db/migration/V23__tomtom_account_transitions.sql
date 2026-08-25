create table if not exists tomtom_account_selection_state (
    provider varchar(64) not null,
    product varchar(96) not null,
    current_account_id varchar(32) not null,
    period_start date not null,
    period_end date not null,
    requests_used bigint not null,
    updated_at timestamptz not null,
    primary key (provider, product),
    constraint chk_tomtom_account_selection_state_usage
        check (requests_used >= 0),
    constraint chk_tomtom_account_selection_state_period
        check (period_end > period_start)
);

create table if not exists tomtom_account_transition (
    id bigserial primary key,
    observed_at timestamptz not null,
    event_type varchar(32) not null,
    provider varchar(64) not null,
    product varchar(96) not null,
    period_start date not null,
    period_end date not null,
    from_account_id varchar(32),
    to_account_id varchar(32) not null,
    calls_reserved integer not null,
    from_account_requests_used bigint,
    to_account_requests_used bigint not null,
    constraint chk_tomtom_account_transition_type
        check (event_type in ('INITIAL_SELECTION', 'ACCOUNT_HANDOFF', 'MONTH_BOUNDARY')),
    constraint chk_tomtom_account_transition_calls
        check (calls_reserved > 0),
    constraint chk_tomtom_account_transition_usage
        check (
            (from_account_requests_used is null or from_account_requests_used >= 0)
            and to_account_requests_used >= 0
        ),
    constraint chk_tomtom_account_transition_period
        check (period_end > period_start)
);

create index if not exists idx_tomtom_account_transition_observed
    on tomtom_account_transition (observed_at desc, id desc);
