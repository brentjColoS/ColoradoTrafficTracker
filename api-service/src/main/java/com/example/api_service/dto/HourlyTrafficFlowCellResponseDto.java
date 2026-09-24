package com.example.api_service.dto;

import java.time.Instant;
import java.util.List;

public record HourlyTrafficFlowCellResponseDto(
    String corridor,
    Instant hourStart,
    Instant hourEnd,
    String resolution,
    List<Cell> cells
) {
    public record Cell(
        String cellId,
        String direction,
        double startMileMarker,
        double endMileMarker,
        int sourceZoomMin,
        int sourceZoomMax,
        int observationCount,
        double avgSpeedMph,
        double minSpeedMph,
        double maxSpeedMph,
        int fullCellObservationCount,
        int partialCellObservationCount,
        int closureObservationCount,
        double minFinestSourceSpanMiles,
        double avgLengthWeightedSourceSpanMiles,
        double maxCoarsestSourceSpanMiles,
        Instant firstObservedAt,
        Instant lastObservedAt
    ) {}
}
