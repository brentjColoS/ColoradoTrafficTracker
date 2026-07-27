create table if not exists traffic_provider_request_budget_monthly (
    period_start date not null,
    period_end date not null,
    provider varchar(64) not null,
    product varchar(96) not null,
    requests_used bigint not null default 0,
    updated_at timestamptz not null default now(),
    primary key (period_start, provider, product),
    check (period_end > period_start),
    check (requests_used >= 0)
);
