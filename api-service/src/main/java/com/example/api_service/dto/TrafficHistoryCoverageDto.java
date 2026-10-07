package com.example.api_service.dto;

import java.time.Instant;

public record TrafficHistoryCoverageDto(
    String corridor,
    Instant firstObservedAt,
    Instant lastObservedAt,
    Instant firstZoneObservedAt,
    Instant lastZoneObservedAt
) {}
