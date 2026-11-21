
        with observations as (
            select
                incident.*,
                case
                    when incident.provider_event_id is not null
                        and length(trim(incident.provider_event_id)) > 0
                        then concat_ws('|', 'provider', incident.incident_provider, incident.provider_event_id)
                    else concat_ws(
                        '|',
                        'legacy',
                        incident.corridor,
                        coalesce(nullif(trim(incident.travel_direction), ''), '?'),
                        coalesce(
                            nullif(trim(incident.normalized_category), ''),
                            nullif(trim(incident.incident_description), ''),
                            cast(incident.icon_category as text),
                            '?'
                        ),
                        coalesce(
                            cast(round(cast(incident.closest_mile_marker as numeric), 1) as text),
                            concat_ws(
                                ',',
                                cast(round(cast(incident.centroid_lat as numeric), 3) as text),
                                cast(round(cast(incident.centroid_lon as numeric), 3) as text)
                            )
                        )
                    )
                end as identity_key
            from traffic_incident_all incident
            join corridor_ref tracked on tracked.code = incident.corridor
            where incident.corridor = :corridor
              and incident.polled_at between :since and :until
              and incident.closest_mile_marker is not null
              and coalesce(lower(incident.mile_marker_method), '') <> 'off_corridor'
              and tracked.start_mile_marker is not null
              and tracked.end_mile_marker is not null
              and incident.closest_mile_marker between
                  least(tracked.start_mile_marker, tracked.end_mile_marker)
                  and greatest(tracked.start_mile_marker, tracked.end_mile_marker)
              and (
                  upper(coalesce(incident.normalized_category, '')) in
                      ('CRASH', 'CONSTRUCTION', 'CLOSURE', 'DISABLED_VEHICLE')
                  or incident.icon_category in (1, 7, 8, 9, 14)
              )
        ), ordered as (
            select
                observations.*,
                lag(polled_at) over (
                    partition by identity_key
                    order by polled_at, history_id
                ) as previous_polled_at
            from observations
        ), numbered as (
            select
                ordered.*,
                sum(
                    case
                        when previous_polled_at is null
                            or polled_at - previous_polled_at > interval '3 minutes'
                            then 1
                        else 0
                    end
                ) over (
                    partition by identity_key
                    order by polled_at, history_id
                ) as lifecycle_number
            from ordered
        ), threaded as (
            select
                numbered.*,
                min(polled_at) over (
                    partition by identity_key, lifecycle_number
                ) as first_seen_at,
                max(polled_at) over (
                    partition by identity_key, lifecycle_number
                ) as last_seen_at,
                row_number() over (
                    partition by identity_key, lifecycle_number
                    order by polled_at desc, history_id desc
                ) as latest_rank
            from numbered
        )
        select
            history_id as eventId,
            (last_seen_at >= :activeSince) as active,
            coalesce(incident_provider, 'historical') as provider,
            incident_product as product,
            coalesce(nullif(provider_event_id, ''), concat(identity_key, '|', lifecycle_number)) as providerEventId,
            normalized_status as sourceStatus,
            normalized_status as normalizedStatus,
            normalized_category as sourceCategory,
            normalized_category as normalizedCategory,
            incident_description as incidentDescription,
            geometry_type as geometryType,
            geometry_json as geometryJson,
            null::timestamptz as sourceStartedAt,
            null::timestamptz as sourceEndedAt,
            source_updated_at as sourceUpdatedAt,
            first_seen_at as firstSeenAt,
            last_seen_at as lastSeenAt,
            jsonb_build_object(
                'properties',
                jsonb_build_object(
                    'iconCategory', icon_category,
                    'delaySeconds', delay_seconds
                )
            )::text as rawEventJson,
            corridor as corridor,
            road_number as roadNumber,
            travel_direction as travelDirection,
            closest_mile_marker as closestMileMarker,
            mile_marker_method as mileMarkerMethod,
            mile_marker_confidence as mileMarkerConfidence,
            distance_to_corridor_meters as distanceToCorridorMeters,
            location_label as locationLabel,
            centroid_lat as centroidLat,
            centroid_lon as centroidLon
        from threaded
        where latest_rank = 1
        order by first_seen_at desc, history_id desc
        limit :limit
