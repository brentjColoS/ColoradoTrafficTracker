package com.example.api_service.dto;

public record MileMarkerCorridorAssessmentDto(
    String corridor,
    Double configuredStartMileMarker,
    Double configuredEndMileMarker,
    Integer configuredAnchorCount,
    Long recentIncidentCount,
    Long resolvedIncidentCount,
    Long unresolvedIncidentCount,
    Long highConfidenceCount,
    Long anchorInterpolatedCount,
    Long rangeInterpolatedCount,
    Long directionOnlyCount,
    Long offCorridorCount,
    Double avgDistanceToCorridorMeters,
    Double resolvedRatePercent,
    Double highConfidenceRatePercent,
    Double anchorCoveragePercent,
    Double offCorridorRatePercent,
    String dominantMethod,
    String qualityState,
    String qualitySummary
) {}
