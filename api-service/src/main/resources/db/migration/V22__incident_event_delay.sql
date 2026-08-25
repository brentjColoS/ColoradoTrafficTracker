alter table traffic_incident_event
    add column if not exists delay_seconds integer;

update traffic_incident_event
set delay_seconds = case
    when raw_event_json::jsonb #>> '{properties,delay}' ~ '^-?[0-9]+$'
        then (raw_event_json::jsonb #>> '{properties,delay}')::integer
    when raw_event_json::jsonb #>> '{properties,delaySeconds}' ~ '^-?[0-9]+$'
        then (raw_event_json::jsonb #>> '{properties,delaySeconds}')::integer
    else null
end
where delay_seconds is null;
