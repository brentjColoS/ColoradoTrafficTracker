package com.example.api_service.dto;

import java.time.Instant;
import java.util.List;

public record TrafficFlowCellFrequencyResponseDto(
    String corridor,
    Instant windowStart,
    Instant windowEnd,
    int requestedHourCount,
    long availableHourCount,
    String resolution,
    List<Cell> cells
) {
    public record Cell(
        String cellId,
        String direction,
        double startMileMarker,
        double endMileMarker,
        int postedSpeedMph,
        long sampledHourCount,
        long observationCount,
        double avgSpeedMph,
        long slowdownHourCount,
        long heavySlowdownHourCount,
        long severeSlowdownHourCount,
        long stoppedHourCount,
        Instant firstObservedAt,
        Instant lastObservedAt
    ) {}
}
