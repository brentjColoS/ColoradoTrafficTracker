package com.example.api_service;

import java.time.OffsetDateTime;
import java.util.List;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface TrafficHistoryIncidentRepository extends JpaRepository<TrafficHistoryIncident, Long> {
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

    @Query("""
        select count(distinct coalesce(i.incidentRefId, i.historyId))
        from TrafficHistoryIncident i
        where i.corridor = :corridor
          and i.polledAt >= :since
        """)
    long countDistinctReferencesByCorridorAndPolledAtGreaterThanEqual(
        @Param("corridor") String corridor,
        @Param("since") OffsetDateTime since
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
