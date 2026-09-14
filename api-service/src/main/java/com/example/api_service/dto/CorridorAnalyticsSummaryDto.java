package com.example.api_service.dto;

import java.time.OffsetDateTime;

public record CorridorAnalyticsSummaryDto(
    String corridor,
    Long bucketCount,
    Long sampleCount,
    Double avgCurrentSpeed,
    Double minCurrentSpeed,
    Double avgSpeedStddev,
    Long incidentObservationCount,
    Long incidentEventCount,
    Long totalIncidentCount,
    OffsetDateTime firstBucketStart,
    OffsetDateTime lastBucketStart
) {
    @Deprecated(since = "1.0", forRemoval = false)
    public Long totalIncidentCount() {
        return totalIncidentCount;
    }
}
