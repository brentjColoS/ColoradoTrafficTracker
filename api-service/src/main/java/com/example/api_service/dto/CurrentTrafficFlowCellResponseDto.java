package com.example.api_service.dto;

import java.time.Instant;
import java.util.List;

public record CurrentTrafficFlowCellResponseDto(
    String corridor,
    Instant observedAt,
    int sourceZoom,
    String status,
    String detail,
    double cellSizeMiles,
    int totalCellCount,
    int supportedCellCount,
    int uniqueSourcePathCount,
    int duplicateSourcePathCount,
    List<Cell> cells
) {
    public record Cell(
        String cellId,
        Instant observedAt,
        double startMileMarker,
        double endMileMarker,
        String direction,
        double speedMph,
        int sourcePathCount,
        int oneSideSourceCount,
        int fullSourceCount,
        int unknownCoverageSourceCount,
        String closureEvidence,
        double coveredMarkerMiles,
        double finestSourceSpanMiles,
        double lengthWeightedSourceSpanMiles,
        double coarsestSourceSpanMiles,
        double coarsestSourceStartMileMarker,
        double coarsestSourceEndMileMarker,
        String quality
    ) {}
}
