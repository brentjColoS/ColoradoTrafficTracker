package com.example.api_service;

import java.time.OffsetDateTime;
import java.util.List;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface TrafficHistorySampleRepository extends JpaRepository<TrafficHistorySample, Long> {
    Page<TrafficHistorySample> findByCorridorAndPolledAtGreaterThanEqualOrderByPolledAtDesc(
        String corridor,
        OffsetDateTime from,
        Pageable pageable
    );

    @Query("""
        select s
        from TrafficHistorySample s
        where s.corridor = :corridor
          and s.polledAt >= :from
          and (s.avgCurrentSpeed is not null
               or s.avgFreeflowSpeed is not null
               or s.minCurrentSpeed is not null)
        order by s.polledAt desc
        """)
    Page<TrafficHistorySample> findUsableByCorridorAndPolledAtGreaterThanEqualOrderByPolledAtDesc(
        @Param("corridor") String corridor,
        @Param("from") OffsetDateTime from,
        Pageable pageable
    );

    @Query("select distinct s.corridor from TrafficHistorySample s order by s.corridor asc")
    List<String> findDistinctCorridors();
}
