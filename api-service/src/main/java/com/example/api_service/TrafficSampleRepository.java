package com.example.api_service;

import java.time.OffsetDateTime;
import java.util.List;
import java.util.Optional;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface TrafficSampleRepository extends JpaRepository<TrafficSample, Long> {
    Optional<TrafficSample> findFirstByCorridorOrderByPolledAtDesc(String corridor);

    @Query("""
        select s
        from TrafficSample s
        where s.corridor = :corridor
          and (s.avgCurrentSpeed is not null
               or s.avgFreeflowSpeed is not null
               or s.minCurrentSpeed is not null)
        order by s.polledAt desc
        """)
    List<TrafficSample> findLatestUsableByCorridor(
        @Param("corridor") String corridor,
        Pageable pageable
    );

    Page<TrafficSample> findByCorridorOrderByPolledAtDesc(String corridor, Pageable pageable);

    Page<TrafficSample> findByCorridorAndPolledAtGreaterThanEqualOrderByPolledAtDesc(
        String corridor,
        OffsetDateTime from,
        Pageable pageable
    );

    @Query("select distinct s.corridor from TrafficSample s order by s.corridor asc")
    List<String> findDistinctCorridors();
}
