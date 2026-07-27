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
    String speedStateSignature,
    String semanticFlowSignature,
    Boolean localizedSlowdown,
    String localizedSlowdownNote,
    String flowProvider,
    String flowProduct,
    Integer flowSourceZoom,
    Integer flowRequestedCadenceSeconds,
    String incidentProvider,
    String incidentProduct,
    OffsetDateTime incidentFetchedAt,
    OffsetDateTime incidentSourceUpdatedAt,
    Integer incidentRequestedCadenceSeconds,
    String incidentsJson,
    OffsetDateTime polledAt,
    Boolean archived,
    OffsetDateTime archivedAt
) {}
