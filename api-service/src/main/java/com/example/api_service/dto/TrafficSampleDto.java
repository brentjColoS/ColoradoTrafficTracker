package com.example.api_service.dto;

import java.time.OffsetDateTime;

public record TrafficSampleDto(
    Long id,
    Long sampleRefId,
    String corridor,
    String sourceMode,
    Double avgCurrentSpeed,
    Double avgFreeflowSpeed,
    Double minCurrentSpeed,
    Double confidence,
    Integer validationRequestedPoints,
    Integer validationReturnedPoints,
    Double validationCoverageRatio,
    Boolean validationUsed,
    Boolean degraded,
    String degradedReason,
    String incidentsJson,
    OffsetDateTime polledAt,
    Boolean archived,
    OffsetDateTime archivedAt
) {}
