package com.example.api_service;

import java.time.OffsetDateTime;
import java.util.List;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;

public interface TrafficSpeedZoneSampleRepository extends JpaRepository<TrafficSpeedZoneSample, Long> {
    List<TrafficSpeedZoneSample> findByCorridorAndPolledAtGreaterThanEqualOrderByPolledAtDescZoneOrderAsc(
        String corridor,
        OffsetDateTime from,
        Pageable pageable
    );

    List<TrafficSpeedZoneSample> findByCorridorAndSampleIdOrderByZoneOrderAsc(String corridor, Long sampleId);
}
