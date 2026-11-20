create table traffic_variable_speed_sign_history (
    sign_id varchar(64) not null,
    observed_at timestamptz not null,
    payload_json text not null,
    primary key (sign_id, observed_at),
    constraint bounded_variable_speed_sign_history_payload check (length(payload_json) <= 4096)
);

create index variable_speed_sign_history_time on traffic_variable_speed_sign_history (observed_at, sign_id);
