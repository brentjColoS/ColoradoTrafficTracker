package com.example.api_service;

import java.time.OffsetDateTime;

public interface TrafficCorridorTrendProjection {
    String getCorridor();
    OffsetDateTime getBucketStart();
    Long getSampleCount();
    Double getAvgCurrentSpeed();
    Double getAvgFreeflowSpeed();
    Double getMinCurrentSpeed();
    Double getAvgConfidence();
    Double getAvgSpeedStddev();
    Double getAvgP50Speed();
    Double getAvgP90Speed();
    Long getTotalIncidents();
    Long getArchivedSampleCount();
}
