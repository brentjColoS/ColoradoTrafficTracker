package com.example.api_service.dto;

import java.time.OffsetDateTime;

public record TrafficSampleDto(
    Long id,
    String corridor,
    Double avgCurrentSpeed,
    Double avgFreeflowSpeed,
    Double minCurrentSpeed,
    Double confidence,
    String incidentsJson,
    OffsetDateTime polledAt
) {}
