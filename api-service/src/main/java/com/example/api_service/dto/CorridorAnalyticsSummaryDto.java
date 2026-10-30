package com.example.api_service.dto;

import com.example.api_service.TrafficCorridorSummaryProjection;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;

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
    public static CorridorAnalyticsSummaryDto from(TrafficCorridorSummaryProjection row, long incidentEvents) {
        Long observations = row.getTotalIncidentCount();
        return new CorridorAnalyticsSummaryDto(row.getCorridor(), row.getBucketCount(), row.getSampleCount(),
            row.getAvgCurrentSpeed(), row.getMinCurrentSpeed(), row.getAvgSpeedStddev(), observations,
            incidentEvents, observations,
            row.getFirstBucketStart() == null ? null : row.getFirstBucketStart().atOffset(ZoneOffset.UTC),
            row.getLastBucketStart() == null ? null : row.getLastBucketStart().atOffset(ZoneOffset.UTC));
    }

    @Deprecated(since = "1.0", forRemoval = false)
    public Long totalIncidentCount() {
        return totalIncidentCount;
    }
}
