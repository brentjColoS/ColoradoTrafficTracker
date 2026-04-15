package com.example.api_service;

import java.time.Instant;

public interface TrafficCorridorSummaryProjection {
    String getCorridor();
    Long getBucketCount();
    Long getSampleCount();
    Double getAvgCurrentSpeed();
    Double getMinCurrentSpeed();
    Double getAvgSpeedStddev();
    Long getTotalIncidentCount();
    Instant getFirstBucketStart();
    Instant getLastBucketStart();
}
