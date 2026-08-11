package com.example.api_service;

import java.util.List;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.Repository;

public interface CurrentIncidentRepository extends Repository<TrafficHistoryIncident, Long> {

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
}
