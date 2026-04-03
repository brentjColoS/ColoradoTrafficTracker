package com.example.ingest_service;

import java.time.OffsetDateTime;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.transaction.annotation.Transactional;

public interface TrafficSampleRepository extends JpaRepository<TrafficSample, Long> {
    Page<TrafficSample> findByCorridorOrderByPolledAtDesc(String corridor, Pageable pageable);

    @Transactional
    int deleteByPolledAtBefore(OffsetDateTime cutoff);
}
