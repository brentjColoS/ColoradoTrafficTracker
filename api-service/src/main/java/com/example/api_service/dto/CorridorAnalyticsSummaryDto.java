package com.example.api_service.dto;

import java.time.OffsetDateTime;

public record CorridorAnalyticsSummaryDto(
    String corridor,
    Long bucketCount,
    Long sampleCount,
    Double avgCurrentSpeed,
    Double minCurrentSpeed,
    Double avgSpeedStddev,
    Long totalIncidentCount,
    OffsetDateTime firstBucketStart,
    OffsetDateTime lastBucketStart
) {}
