package com.example.api_service.dto;

import java.time.OffsetDateTime;

public record ForecastPointDto(
    OffsetDateTime timestamp,
    double predictedSpeed,
    double lowerBoundSpeed,
    double upperBoundSpeed
) {}
