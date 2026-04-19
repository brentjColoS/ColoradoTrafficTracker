package com.example.ingest_service;

import java.time.OffsetDateTime;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;

public interface TrafficIncidentRepository extends JpaRepository<TrafficIncident, Long> {
    Page<TrafficIncident> findByPolledAtGreaterThanEqualOrderByPolledAtAsc(
        OffsetDateTime since,
        Pageable pageable
    );
}
