package com.example.api_service.dto;

import java.time.OffsetDateTime;

public record CorridorTrendPointDto(
    OffsetDateTime bucketStart,
    Long sampleCount,
    Double avgCurrentSpeed,
    Double avgFreeflowSpeed,
    Double minCurrentSpeed,
    Double avgConfidence,
    Double avgSpeedStddev,
    Double avgP50Speed,
    Double avgP90Speed,
    Long totalIncidents,
    Long archivedSampleCount
) {}
