create table traffic_variable_speed_sign_current (
    sign_id varchar(64) primary key,
    last_attempt_at timestamptz not null,
    payload_json text not null,
    constraint bounded_variable_speed_sign_payload check (length(payload_json) <= 4096)
);
