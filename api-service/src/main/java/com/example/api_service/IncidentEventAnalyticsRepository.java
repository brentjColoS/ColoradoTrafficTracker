package com.example.api_service;

import java.time.OffsetDateTime;
import java.util.List;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.Repository;
import org.springframework.data.repository.query.Param;

public interface IncidentEventAnalyticsRepository extends Repository<TrafficHistoryIncident, Long> {

    String HOTSPOT_ROWS = """
        select
            e.id as event_id,
            c.corridor,
            coalesce(nullif(trim(c.travel_direction), ''), '?') as travel_direction,
            cast(floor(c.closest_mile_marker) as integer) as mile_marker_band,
            e.delay_seconds,
            greatest(
                1,
                (
                    select count(*)
                    from traffic_incident_event_transition transition
                    where transition.event_id = e.id
                      and transition.occurred_at >= :since
                      and transition.active = true
                )
            ) as observation_count,
            greatest(e.first_seen_at, :since) as first_seen_at,
            e.last_seen_at
        from traffic_incident_event e
        join traffic_incident_event_corridor c on c.event_id = e.id
        join corridor_ref tracked on tracked.code = c.corridor
        where (e.active = true or e.last_seen_at >= :since)
          and (c.active = true or c.last_matched_at >= :since)
          and c.closest_mile_marker is not null
          and coalesce(lower(c.mile_marker_method), '') <> 'off_corridor'
          and tracked.start_mile_marker is not null
          and tracked.end_mile_marker is not null
          and c.closest_mile_marker between
              least(tracked.start_mile_marker, tracked.end_mile_marker)
              and greatest(tracked.start_mile_marker, tracked.end_mile_marker)
        """;

    String HOTSPOT_SELECT = """
        select
            event_rows.corridor as corridor,
            event_rows.travel_direction as travelDirection,
            event_rows.mile_marker_band as mileMarkerBand,
            sum(event_rows.observation_count) as observationCount,
            count(*) as incidentCount,
            avg(event_rows.delay_seconds) as avgDelaySeconds,
            max(event_rows.delay_seconds) as maxDelaySeconds,
            min(event_rows.first_seen_at) as firstSeenAt,
            max(event_rows.last_seen_at) as lastSeenAt,
            cast(0 as bigint) as archivedObservationCount,
            cast(0 as bigint) as archivedIncidentCount
        from (
        """;

    String HOTSPOT_GROUP_AND_ORDER = """
        ) event_rows
        group by
            event_rows.corridor,
            event_rows.travel_direction,
            event_rows.mile_marker_band
        order by
            sum(event_rows.observation_count) desc,
            count(*) desc,
            coalesce(max(event_rows.delay_seconds), 0) desc,
            coalesce(avg(event_rows.delay_seconds), 0) desc,
            max(event_rows.last_seen_at) desc,
            event_rows.corridor asc
        limit :limit
        """;

    @Query(
        value = """
            select count(*)
            from traffic_incident_event e
            join traffic_incident_event_corridor c on c.event_id = e.id
            where c.corridor = :corridor
              and e.last_seen_at >= :since
              and c.last_matched_at >= :since
            """,
        nativeQuery = true
    )
    long countRecentMatches(
        @Param("corridor") String corridor,
        @Param("since") OffsetDateTime since
    );

    @Query(
        value = """
            select count(*)
            from traffic_incident_event e
            join traffic_incident_event_corridor c on c.event_id = e.id
            where c.corridor = :corridor
              and e.last_seen_at >= :since
              and c.last_matched_at >= :since
              and c.closest_mile_marker is null
            """,
        nativeQuery = true
    )
    long countRecentMatchesWithoutMileMarker(
        @Param("corridor") String corridor,
        @Param("since") OffsetDateTime since
    );

    @Query(
        value = """
            select count(distinct e.id)
            from traffic_incident_event e
            join traffic_incident_event_corridor c on c.event_id = e.id
            where c.corridor = :corridor
              and e.last_seen_at >= :since
              and c.last_matched_at >= :since
            """,
        nativeQuery = true
    )
    long countRecentEvents(
        @Param("corridor") String corridor,
        @Param("since") OffsetDateTime since
    );

    @Query(
        value = """
            select count(distinct e.id)
            from traffic_incident_event e
            join traffic_incident_event_corridor c on c.event_id = e.id
            where c.corridor = :corridor
              and e.first_seen_at < :until
              and (e.active = true or e.last_seen_at >= :from)
              and c.first_matched_at < :until
              and (c.active = true or c.last_matched_at >= :from)
            """,
        nativeQuery = true
    )
    long countEventsOverlapping(
        @Param("corridor") String corridor,
        @Param("from") OffsetDateTime from,
        @Param("until") OffsetDateTime until
    );

    @Query(
        value = HOTSPOT_SELECT + HOTSPOT_ROWS + """
              and c.corridor = :corridor
            """ + HOTSPOT_GROUP_AND_ORDER,
        nativeQuery = true
    )
    List<TrafficIncidentHotspotProjection> findHotspotsByCorridor(
        @Param("corridor") String corridor,
        @Param("since") OffsetDateTime since,
        @Param("limit") int limit
    );

    @Query(
        value = HOTSPOT_SELECT + HOTSPOT_ROWS + HOTSPOT_GROUP_AND_ORDER,
        nativeQuery = true
    )
    List<TrafficIncidentHotspotProjection> findHotspots(
        @Param("since") OffsetDateTime since,
        @Param("limit") int limit
    );
}
