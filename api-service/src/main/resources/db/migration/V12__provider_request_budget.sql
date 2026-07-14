create table if not exists traffic_provider_request_budget (
    budget_day date not null,
    budget_key varchar(64) not null,
    requests_used bigint not null default 0,
    updated_at timestamptz not null default now(),
    primary key (budget_day, budget_key),
    check (requests_used >= 0)
);
