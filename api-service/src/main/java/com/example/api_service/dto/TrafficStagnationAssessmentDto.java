package com.example.api_service.dto;

public record TrafficStagnationAssessmentDto(
    String operatingMode,
    String signalState,
    String severity,
    boolean eventActive,
    Integer recentUsableSampleCount60m,
    Integer flatRunMinutes,
    Integer flatRunRows,
    Integer distinctAverageCount60m,
    Double repeatedStepRatio60m,
    Integer incidentCount30m,
    Integer priorIncidentCount30m,
    Double minimumSpeedDeltaFrom2hAverage,
    Double averageSpeedShift15m,
    String note
) {}
