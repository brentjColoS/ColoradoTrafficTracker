package com.example.ingest_service;

import java.time.Instant;
import java.util.List;

record CorridorFlowCellSnapshot(
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
    record Cell(
        String id,
        double startMileMarker,
        double endMileMarker,
        Direction direction,
        double speedMph,
        int sourcePathCount,
        int oneSideSourceCount,
        int fullSourceCount,
        int unknownCoverageSourceCount,
        ClosureEvidence closureEvidence,
        double coveredMarkerMiles,
        double finestSourceSpanMiles,
        double lengthWeightedSourceSpanMiles,
        double coarsestSourceSpanMiles,
        double coarsestSourceStartMileMarker,
        double coarsestSourceEndMileMarker,
        Quality quality
    ) {}

    enum Direction {
        COMBINED
    }

    enum Quality {
        FULL_CELL,
        PARTIAL_CELL
    }

    enum ClosureEvidence {
        NONE,
        ONE_SIDE_REPORTED,
        FULL_REPORTED,
        UNSPECIFIED_REPORTED,
        MIXED_REPORTED
    }
}
