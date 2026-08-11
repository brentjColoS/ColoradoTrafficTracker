create table if not exists tomtom_reset_probe_run (
    id bigint generated always as identity primary key,
    ran_at timestamptz not null,
    eligible_account_count integer not null,
    attempted_account_count integer not null,
    constraint chk_tomtom_reset_probe_run_eligible_count
        check (eligible_account_count >= 0),
    constraint chk_tomtom_reset_probe_run_attempted_count
        check (
            attempted_account_count >= 0
            and attempted_account_count <= eligible_account_count
        )
);

create index if not exists idx_tomtom_reset_probe_run_time
    on tomtom_reset_probe_run (ran_at desc);
