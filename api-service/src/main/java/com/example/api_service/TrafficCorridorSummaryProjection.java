package com.example.api_service;

import java.time.OffsetDateTime;

public interface TrafficCorridorSummaryProjection {
    String getCorridor();
    Long getBucketCount();
    Long getSampleCount();
    Double getAvgCurrentSpeed();
    Double getMinCurrentSpeed();
    Double getAvgSpeedStddev();
    Long getTotalIncidentCount();
    OffsetDateTime getFirstBucketStart();
    OffsetDateTime getLastBucketStart();
}
