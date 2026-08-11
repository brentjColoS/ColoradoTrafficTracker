package com.example.api_service.dto;

import java.time.OffsetDateTime;
import java.util.List;

public record IncidentModelParityDto(
    OffsetDateTime generatedAt,
    boolean comparisonReady,
    boolean inParity,
    String comparisonError,
    int corridorCount,
    int compatibilityIncidentCount,
    int durableIncidentCount,
    int matchingIdentityCount,
    int mismatchCount,
    List<IncidentCorridorParityDto> corridors
) {}
