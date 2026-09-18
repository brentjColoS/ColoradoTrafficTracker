package com.example.api_service;

import java.time.OffsetDateTime;
import java.util.List;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.Repository;
import org.springframework.data.repository.query.Param;

public interface CurrentIncidentRepository extends Repository<TrafficHistoryIncident, Long> {

    String HISTORICAL_TIMELINE_SELECT = """
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
        """;

    String INCIDENT_SELECT = """
        select
            e.id as eventId,
            (e.active and c.active) as active,
            e.provider as provider,
            e.product as product,
            e.provider_event_id as providerEventId,
            e.source_status as sourceStatus,
            e.normalized_status as normalizedStatus,
            e.source_category as sourceCategory,
            e.normalized_category as normalizedCategory,
            e.incident_description as incidentDescription,
            e.geometry_type as geometryType,
            e.geometry_json as geometryJson,
            e.source_started_at as sourceStartedAt,
            e.source_ended_at as sourceEndedAt,
            e.source_updated_at as sourceUpdatedAt,
            e.first_seen_at as firstSeenAt,
            e.last_seen_at as lastSeenAt,
            e.raw_event_json as rawEventJson,
            c.corridor as corridor,
            c.road_number as roadNumber,
            c.travel_direction as travelDirection,
            c.closest_mile_marker as closestMileMarker,
            c.mile_marker_method as mileMarkerMethod,
            c.mile_marker_confidence as mileMarkerConfidence,
            c.distance_to_corridor_meters as distanceToCorridorMeters,
            c.location_label as locationLabel,
            c.centroid_lat as centroidLat,
            c.centroid_lon as centroidLon
        from traffic_incident_event e
        join traffic_incident_event_corridor c on c.event_id = e.id
        join corridor_ref tracked on tracked.code = c.corridor
        """;

    // Durable incident events became the source of truth when the CDOT adapter
    // replaced incident arrays copied into traffic samples. Reconstruct active
    // state relative to the requested replay instant instead of using today's
    // e.active/c.active flags.
    String DURABLE_TIMELINE_SELECT = """
        select
            e.id as eventId,
            (
                greatest(coalesce(e.source_started_at, e.first_seen_at), c.first_matched_at) <= :until
                and (
                    (e.source_ended_at is not null
                        and least(e.source_ended_at, c.last_matched_at) >= :until)
                    or (e.source_ended_at is null
                        and least(e.last_seen_at, c.last_matched_at) >= :activeSince)
                )
            ) as active,
            e.provider as provider,
            e.product as product,
            e.provider_event_id as providerEventId,
            e.source_status as sourceStatus,
            e.normalized_status as normalizedStatus,
            e.source_category as sourceCategory,
            e.normalized_category as normalizedCategory,
            e.incident_description as incidentDescription,
            e.geometry_type as geometryType,
            e.geometry_json as geometryJson,
            e.source_started_at as sourceStartedAt,
            e.source_ended_at as sourceEndedAt,
            e.source_updated_at as sourceUpdatedAt,
            greatest(coalesce(e.source_started_at, e.first_seen_at), c.first_matched_at) as firstSeenAt,
            least(coalesce(e.source_ended_at, e.last_seen_at), c.last_matched_at, :until) as lastSeenAt,
            e.raw_event_json as rawEventJson,
            c.corridor as corridor,
            c.road_number as roadNumber,
            c.travel_direction as travelDirection,
            c.closest_mile_marker as closestMileMarker,
            c.mile_marker_method as mileMarkerMethod,
            c.mile_marker_confidence as mileMarkerConfidence,
            c.distance_to_corridor_meters as distanceToCorridorMeters,
            c.location_label as locationLabel,
            c.centroid_lat as centroidLat,
            c.centroid_lon as centroidLon
        from traffic_incident_event e
        join traffic_incident_event_corridor c on c.event_id = e.id
        join corridor_ref tracked on tracked.code = c.corridor
        where c.corridor = :corridor
          and greatest(coalesce(e.source_started_at, e.first_seen_at), c.first_matched_at) <= :until
          and least(coalesce(e.source_ended_at, e.last_seen_at), c.last_matched_at) >= :since
        """;

    String TRACKED_LOCATION = """
          and c.closest_mile_marker is not null
          and coalesce(lower(c.mile_marker_method), '') <> 'off_corridor'
          and tracked.start_mile_marker is not null
          and tracked.end_mile_marker is not null
          and c.closest_mile_marker between
              least(tracked.start_mile_marker, tracked.end_mile_marker)
              and greatest(tracked.start_mile_marker, tracked.end_mile_marker)
        """;

    String CURRENT_INCIDENT_SELECT = INCIDENT_SELECT
        + "where e.active = true and c.active = true " + TRACKED_LOCATION;

    String CURRENT_INCIDENT_ORDER = """
        order by e.last_seen_at desc, e.id desc, c.corridor asc
        limit :limit
        """;

    @Query(
        value = """
            select
                e.id as eventId,
                e.provider as provider,
                e.product as product,
                e.provider_event_id as providerEventId,
                e.source_status as sourceStatus,
                e.normalized_status as normalizedStatus,
                e.source_category as sourceCategory,
                e.normalized_category as normalizedCategory,
                e.incident_description as incidentDescription,
                e.geometry_type as geometryType,
                e.geometry_json as geometryJson,
                e.source_started_at as sourceStartedAt,
                e.source_ended_at as sourceEndedAt,
                e.source_updated_at as sourceUpdatedAt,
                e.first_seen_at as firstSeenAt,
                e.last_seen_at as lastSeenAt,
                e.raw_event_json as rawEventJson,
                c.corridor as corridor,
                c.road_number as roadNumber,
                c.travel_direction as travelDirection,
                c.closest_mile_marker as closestMileMarker,
                c.mile_marker_method as mileMarkerMethod,
                c.mile_marker_confidence as mileMarkerConfidence,
                c.distance_to_corridor_meters as distanceToCorridorMeters,
                c.location_label as locationLabel,
                c.centroid_lat as centroidLat,
                c.centroid_lon as centroidLon
            from traffic_incident_event e
            join traffic_incident_event_corridor c on c.event_id = e.id
            where e.active = true
              and c.active = true
            order by c.corridor asc, e.last_seen_at desc, e.id desc
            """,
        nativeQuery = true
    )
    List<CurrentIncidentProjection> findAllCurrent();

    @Query(
        value = CURRENT_INCIDENT_SELECT + """
              and e.last_seen_at >= :since
            """ + CURRENT_INCIDENT_ORDER,
        nativeQuery = true
    )
    List<CurrentIncidentProjection> findCurrentSince(
        @Param("since") OffsetDateTime since,
        @Param("limit") int limit
    );

    @Query(
        value = CURRENT_INCIDENT_SELECT + """
              and c.corridor = :corridor
              and e.last_seen_at >= :since
            """ + CURRENT_INCIDENT_ORDER,
        nativeQuery = true
    )
    List<CurrentIncidentProjection> findCurrentByCorridorSince(
        @Param("corridor") String corridor,
        @Param("since") OffsetDateTime since,
        @Param("limit") int limit
    );

    // The dashboard needs ended events as well as current ones. Keep the map's
    // active-only contract and share its tracked-corridor/location restrictions.
    @Query(
        value = INCIDENT_SELECT
            + "where (e.active = true or e.last_seen_at >= :since) "
            + "and (c.active = true or c.last_matched_at >= :since) "
            + TRACKED_LOCATION + " and c.corridor = :corridor " + CURRENT_INCIDENT_ORDER,
        nativeQuery = true
    )
    List<CurrentIncidentProjection> findRecentByCorridorSince(
        @Param("corridor") String corridor,
        @Param("since") OffsetDateTime since,
        @Param("limit") int limit
    );

    @Query(
        value = DURABLE_TIMELINE_SELECT + TRACKED_LOCATION + """
            order by greatest(coalesce(e.source_started_at, e.first_seen_at), c.first_matched_at) asc, e.id asc
            limit :limit
            """,
        nativeQuery = true
    )
    List<CurrentIncidentProjection> findDurableTimelineByCorridorBetween(
        @Param("corridor") String corridor,
        @Param("since") OffsetDateTime since,
        @Param("until") OffsetDateTime until,
        @Param("activeSince") OffsetDateTime activeSince,
        @Param("limit") int limit
    );

    @Query(
        value = "select exists(select 1 from traffic_incident_event where first_seen_at <= :until)",
        nativeQuery = true
    )
    boolean hasDurableEventsAtOrBefore(@Param("until") OffsetDateTime until);

    @Query(value = HISTORICAL_TIMELINE_SELECT, nativeQuery = true)
    List<CurrentIncidentProjection> findHistoricalTimelineByCorridorBetween(
        @Param("corridor") String corridor,
        @Param("since") OffsetDateTime since,
        @Param("until") OffsetDateTime until,
        @Param("activeSince") OffsetDateTime activeSince,
        @Param("limit") int limit
    );
}
