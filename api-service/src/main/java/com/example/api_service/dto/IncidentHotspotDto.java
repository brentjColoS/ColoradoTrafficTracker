package com.example.api_service.dto;

import java.time.OffsetDateTime;

public record IncidentHotspotDto(
    String corridor,
    String travelDirection,
    String travelDirectionLabel,
    Integer mileMarkerBand,
    String referenceLabel,
    Long incidentCount,
    Double avgDelaySeconds,
    Integer maxDelaySeconds,
    Long archivedIncidentCount,
    OffsetDateTime firstSeenAt,
    OffsetDateTime lastSeenAt
) {}
