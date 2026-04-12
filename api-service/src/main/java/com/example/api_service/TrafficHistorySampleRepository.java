package com.example.api_service;

import java.time.OffsetDateTime;
import java.util.List;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;

public interface TrafficHistorySampleRepository extends JpaRepository<TrafficHistorySample, Long> {
    Page<TrafficHistorySample> findByCorridorAndPolledAtGreaterThanEqualOrderByPolledAtDesc(
        String corridor,
        OffsetDateTime from,
        Pageable pageable
    );

    @Query("select distinct s.corridor from TrafficHistorySample s order by s.corridor asc")
    List<String> findDistinctCorridors();
}
