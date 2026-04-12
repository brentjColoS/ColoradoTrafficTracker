package com.example.api_service;

import java.time.OffsetDateTime;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;

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
}
