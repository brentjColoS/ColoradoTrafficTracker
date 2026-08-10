package com.example.api_service;

import java.time.OffsetDateTime;
import java.util.List;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface TrafficHistoryIncidentRepository extends JpaRepository<TrafficHistoryIncident, Long> {
    @Query(
        value = """
            select latest.*
            from (
                select distinct on (
                    case
                        when provider_event_id is not null and length(trim(provider_event_id)) > 0
                            then concat_ws('|', incident_provider, provider_event_id)
                        else concat_ws(
                            '|',
                            corridor,
                            coalesce(nullif(trim(travel_direction), ''), '?'),
                            coalesce(cast(round(cast(closest_mile_marker as numeric), 1) as text), ''),
                            coalesce(
                                nullif(upper(trim(location_label)), ''),
                                concat_ws(
                                    ',',
                                    coalesce(cast(round(cast(centroid_lat as numeric), 4) as text), ''),
                                    coalesce(cast(round(cast(centroid_lon as numeric), 4) as text), ''),
                                    coalesce(geometry_type, '')
                                )
                            )
                        )
                    end
                ) incident.*
                from traffic_incident_all incident
                where corridor = :corridor
                  and polled_at >= :since
                  and closest_mile_marker is not null
                  and coalesce(lower(mile_marker_method), '') <> 'off_corridor'
                  and exists (
                      select 1
                      from corridor_ref tracked
                      where tracked.code = incident.corridor
                        and tracked.start_mile_marker is not null
                        and tracked.end_mile_marker is not null
                        and incident.closest_mile_marker between
                            least(tracked.start_mile_marker, tracked.end_mile_marker)
                            and greatest(tracked.start_mile_marker, tracked.end_mile_marker)
                  )
                order by
                    case
                        when provider_event_id is not null and length(trim(provider_event_id)) > 0
                            then concat_ws('|', incident_provider, provider_event_id)
                        else concat_ws(
                            '|',
                            corridor,
                            coalesce(nullif(trim(travel_direction), ''), '?'),
                            coalesce(cast(round(cast(closest_mile_marker as numeric), 1) as text), ''),
                            coalesce(
                                nullif(upper(trim(location_label)), ''),
                                concat_ws(
                                    ',',
                                    coalesce(cast(round(cast(centroid_lat as numeric), 4) as text), ''),
                                    coalesce(cast(round(cast(centroid_lon as numeric), 4) as text), ''),
                                    coalesce(geometry_type, '')
                                )
                            )
                        )
                    end,
                    polled_at desc,
                    history_id desc
            ) latest
            order by latest.polled_at desc, latest.history_id desc
            limit :limit
            """,
        nativeQuery = true
    )
    List<TrafficHistoryIncident> findLatestDistinctReferencesByCorridorSince(
        @Param("corridor") String corridor,
        @Param("since") OffsetDateTime since,
        @Param("limit") int limit
    );

    @Query(
        value = """
            select latest.*
            from (
                select distinct on (
                    case
                        when provider_event_id is not null and length(trim(provider_event_id)) > 0
                            then concat_ws('|', incident_provider, provider_event_id)
                        else concat_ws(
                            '|',
                            corridor,
                            coalesce(nullif(trim(travel_direction), ''), '?'),
                            coalesce(cast(round(cast(closest_mile_marker as numeric), 1) as text), ''),
                            coalesce(
                                nullif(upper(trim(location_label)), ''),
                                concat_ws(
                                    ',',
                                    coalesce(cast(round(cast(centroid_lat as numeric), 4) as text), ''),
                                    coalesce(cast(round(cast(centroid_lon as numeric), 4) as text), ''),
                                    coalesce(geometry_type, '')
                                )
                            )
                        )
                    end
                ) incident.*
                from traffic_incident_all incident
                where polled_at >= :since
                  and closest_mile_marker is not null
                  and coalesce(lower(mile_marker_method), '') <> 'off_corridor'
                  and exists (
                      select 1
                      from corridor_ref tracked
                      where tracked.code = incident.corridor
                        and tracked.start_mile_marker is not null
                        and tracked.end_mile_marker is not null
                        and incident.closest_mile_marker between
                            least(tracked.start_mile_marker, tracked.end_mile_marker)
                            and greatest(tracked.start_mile_marker, tracked.end_mile_marker)
                  )
                order by
                    case
                        when provider_event_id is not null and length(trim(provider_event_id)) > 0
                            then concat_ws('|', incident_provider, provider_event_id)
                        else concat_ws(
                            '|',
                            corridor,
                            coalesce(nullif(trim(travel_direction), ''), '?'),
                            coalesce(cast(round(cast(closest_mile_marker as numeric), 1) as text), ''),
                            coalesce(
                                nullif(upper(trim(location_label)), ''),
                                concat_ws(
                                    ',',
                                    coalesce(cast(round(cast(centroid_lat as numeric), 4) as text), ''),
                                    coalesce(cast(round(cast(centroid_lon as numeric), 4) as text), ''),
                                    coalesce(geometry_type, '')
                                )
                            )
                        )
                    end,
                    polled_at desc,
                    history_id desc
            ) latest
            order by latest.polled_at desc, latest.history_id desc
            limit :limit
            """,
        nativeQuery = true
    )
    List<TrafficHistoryIncident> findLatestDistinctReferencesSince(
        @Param("since") OffsetDateTime since,
        @Param("limit") int limit
    );

    Page<TrafficHistoryIncident> findByCorridorAndPolledAtGreaterThanEqualOrderByPolledAtDesc(
        String corridor,
        OffsetDateTime since,
        Pageable pageable
    );

    Page<TrafficHistoryIncident> findByPolledAtGreaterThanEqualOrderByPolledAtDesc(
        OffsetDateTime since,
        Pageable pageable
    );

    long countByCorridorAndPolledAtGreaterThanEqual(String corridor, OffsetDateTime since);

    long countByCorridorAndPolledAtGreaterThanEqualAndClosestMileMarkerIsNotNull(String corridor, OffsetDateTime since);

    long countByCorridorAndPolledAtGreaterThanEqualAndClosestMileMarkerIsNull(String corridor, OffsetDateTime since);

    @Query(
        value = """
            select count(distinct case
                when provider_event_id is not null and length(trim(provider_event_id)) > 0
                    then concat_ws('|', incident_provider, provider_event_id)
                else concat_ws(
                    '|',
                    corridor,
                    coalesce(nullif(trim(travel_direction), ''), '?'),
                    coalesce(cast(round(cast(closest_mile_marker as numeric), 1) as text), ''),
                    coalesce(
                        nullif(upper(trim(location_label)), ''),
                        concat_ws(
                            ',',
                            coalesce(cast(round(cast(centroid_lat as numeric), 4) as text), ''),
                            coalesce(cast(round(cast(centroid_lon as numeric), 4) as text), ''),
                            coalesce(geometry_type, '')
                        )
                    )
                )
            end)
            from traffic_incident_all incident
            where incident.corridor = :corridor
              and incident.polled_at >= :since
              and incident.closest_mile_marker is not null
              and coalesce(lower(incident.mile_marker_method), '') <> 'off_corridor'
              and exists (
                  select 1
                  from corridor_ref tracked
                  where tracked.code = incident.corridor
                    and tracked.start_mile_marker is not null
                    and tracked.end_mile_marker is not null
                    and incident.closest_mile_marker between
                        least(tracked.start_mile_marker, tracked.end_mile_marker)
                        and greatest(tracked.start_mile_marker, tracked.end_mile_marker)
              )
            """,
        nativeQuery = true
    )
    long countDistinctReferencesByCorridorAndPolledAtGreaterThanEqual(
        @Param("corridor") String corridor,
        @Param("since") OffsetDateTime since
    );

    @Query(
        value = """
            select count(distinct case
                when provider_event_id is not null and length(trim(provider_event_id)) > 0
                    then concat_ws('|', incident_provider, provider_event_id)
                else concat_ws(
                    '|',
                    corridor,
                    coalesce(nullif(trim(travel_direction), ''), '?'),
                    coalesce(cast(round(cast(closest_mile_marker as numeric), 1) as text), ''),
                    coalesce(
                        nullif(upper(trim(location_label)), ''),
                        concat_ws(
                            ',',
                            coalesce(cast(round(cast(centroid_lat as numeric), 4) as text), ''),
                            coalesce(cast(round(cast(centroid_lon as numeric), 4) as text), ''),
                            coalesce(geometry_type, '')
                        )
                    )
                )
            end)
            from traffic_incident_all incident
            where incident.corridor = :corridor
              and incident.polled_at >= :from
              and incident.polled_at < :until
              and incident.closest_mile_marker is not null
              and coalesce(lower(incident.mile_marker_method), '') <> 'off_corridor'
              and exists (
                  select 1
                  from corridor_ref tracked
                  where tracked.code = incident.corridor
                    and tracked.start_mile_marker is not null
                    and tracked.end_mile_marker is not null
                    and incident.closest_mile_marker between
                        least(tracked.start_mile_marker, tracked.end_mile_marker)
                        and greatest(tracked.start_mile_marker, tracked.end_mile_marker)
              )
            """,
        nativeQuery = true
    )
    long countDistinctReferencesByCorridorAndPolledAtRange(
        @Param("corridor") String corridor,
        @Param("from") OffsetDateTime from,
        @Param("until") OffsetDateTime until
    );

    long countByCorridorAndPolledAtGreaterThanEqualAndMileMarkerMethod(String corridor, OffsetDateTime since, String mileMarkerMethod);

    long countByCorridorAndPolledAtGreaterThanEqualAndClosestMileMarkerIsNotNullAndMileMarkerConfidenceGreaterThanEqual(
        String corridor,
        OffsetDateTime since,
        Double mileMarkerConfidence
    );

    @Query("""
        select avg(i.distanceToCorridorMeters)
        from TrafficHistoryIncident i
        where i.corridor = :corridor
          and i.polledAt >= :since
          and i.distanceToCorridorMeters is not null
        """)
    Double averageDistanceToCorridorMeters(
        @Param("corridor") String corridor,
        @Param("since") OffsetDateTime since
    );
}
