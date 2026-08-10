package com.example.api_service.dto;

import com.fasterxml.jackson.annotation.JsonInclude;
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
    Integer speedSampleCount,
    Double speedStddev,
    Double p10Speed,
    Double p50Speed,
    Double p90Speed,
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
    Integer incidentCount,
    @JsonInclude(JsonInclude.Include.NON_NULL)
    String incidentsJson,
    OffsetDateTime polledAt,
    Boolean archived,
    OffsetDateTime archivedAt
) {}
