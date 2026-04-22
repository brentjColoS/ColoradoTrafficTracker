package com.example.api_service.dto;

import java.time.OffsetDateTime;

public record TrafficSlowdownEventDto(
    String eventId,
    String label,
    String corridor,
    OffsetDateTime startedAt,
    OffsetDateTime endedAt,
    long durationMinutes,
    int sampleCount,
    double minimumObservedSpeed,
    double averageObservedSpeed,
    double maximumDropMph,
    double strongestZScore
) {}
