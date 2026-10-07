package com.example.api_service;

import java.time.OffsetDateTime;
import java.util.List;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.Repository;
import org.springframework.data.repository.query.Param;

public interface CurrentIncidentRepository extends Repository<TrafficHistoryIncident, Long> {

    String CURRENT_INCIDENT_SELECT = """
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
        join corridor_ref tracked on tracked.code = c.corridor
        where e.active = true
          and c.active = true
          and c.closest_mile_marker is not null
          and coalesce(lower(c.mile_marker_method), '') <> 'off_corridor'
          and tracked.start_mile_marker is not null
          and tracked.end_mile_marker is not null
          and c.closest_mile_marker between
              least(tracked.start_mile_marker, tracked.end_mile_marker)
              and greatest(tracked.start_mile_marker, tracked.end_mile_marker)
        """;

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
}
