alter table traffic_provider_request_budget_monthly
    add column if not exists account_id varchar(64) not null default 'primary';

alter table traffic_provider_request_budget_monthly
    drop constraint if exists traffic_provider_request_budget_monthly_pkey;

alter table traffic_provider_request_budget_monthly
    add constraint traffic_provider_request_budget_monthly_pkey
        primary key (period_start, provider, account_id, product);

alter table traffic_provider_request_budget_monthly
    add constraint traffic_provider_request_budget_monthly_account_not_blank
        check (length(trim(account_id)) > 0);
