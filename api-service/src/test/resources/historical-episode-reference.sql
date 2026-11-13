with observations as (
    select incident.polled_at, incident.history_id,
        date_bin(interval '7 days', incident.polled_at, timestamptz '1970-01-05 00:00:00+00') as week,
        case when nullif(trim(incident.provider_event_id), '') is not null
            then concat_ws('|', 'provider', incident.incident_provider, incident.provider_event_id)
            else concat_ws('|', 'legacy', incident.corridor,
                coalesce(nullif(trim(incident.travel_direction), ''), '?'),
                coalesce(nullif(trim(incident.normalized_category), ''),
                    nullif(trim(incident.incident_description), ''), cast(incident.icon_category as text), '?'),
                cast(round(cast(incident.closest_mile_marker as numeric), 1) as text)) end as identity
    from traffic_incident_all incident
    join corridor_ref tracked on tracked.code = incident.corridor
    where incident.corridor = ? and incident.polled_at >= ? and incident.polled_at < ?
      and date_bin(interval '7 days', incident.polled_at, timestamptz '1970-01-05 00:00:00+00') in (%s)
      and coalesce(lower(incident.mile_marker_method), '') <> 'off_corridor'
      and incident.closest_mile_marker between least(tracked.start_mile_marker, tracked.end_mile_marker)
          and greatest(tracked.start_mile_marker, tracked.end_mile_marker)
      and (upper(coalesce(incident.normalized_category, '')) in
            ('CRASH', 'CONSTRUCTION', 'CLOSURE', 'DISABLED_VEHICLE')
          or incident.icon_category in (1, 7, 8, 9, 14))
), ordered as (
    select *, lag(polled_at) over lifecycle as previous,
        lead(polled_at) over lifecycle as next
    from observations
    window lifecycle as (partition by week, identity order by polled_at, history_id)
), endpoints as (
    select week, identity, polled_at,
        (previous is null or polled_at - previous > interval '3 minutes') as first,
        (next is null or next - polled_at > interval '3 minutes') as last
    from ordered
)
select * from endpoints where first or last order by week, identity, polled_at
