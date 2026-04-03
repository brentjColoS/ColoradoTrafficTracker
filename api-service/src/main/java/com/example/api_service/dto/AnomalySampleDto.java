package com.example.api_service.dto;

import java.time.OffsetDateTime;

public record AnomalySampleDto(
    OffsetDateTime polledAt,
    double observedSpeed,
    double expectedMinimumSpeed,
    double zScore
) {}
