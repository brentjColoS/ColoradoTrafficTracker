package com.example.traffic_backend;

import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;

public interface TrafficSampleRepository extends JpaRepository<TrafficSample, Long> {
    Page<TrafficSample> findByCorridorOrderByPolledAtDesc(String corridor, Pageable pageable);
}
