package com.example.api_service;

import java.time.OffsetDateTime;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface TrafficHistoryIncidentRepository extends JpaRepository<TrafficHistoryIncident, Long> {
    long countByCorridorAndPolledAtGreaterThanEqual(String corridor, OffsetDateTime since);

    long countByCorridorAndPolledAtGreaterThanEqualAndClosestMileMarkerIsNotNull(String corridor, OffsetDateTime since);

    long countByCorridorAndPolledAtGreaterThanEqualAndClosestMileMarkerIsNull(String corridor, OffsetDateTime since);

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
