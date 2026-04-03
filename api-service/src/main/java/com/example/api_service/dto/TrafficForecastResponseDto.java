package com.example.api_service.dto;

import java.time.OffsetDateTime;
import java.util.List;

public record TrafficForecastResponseDto(
    String corridor,
    String model,
    OffsetDateTime generatedAt,
    int horizonMinutes,
    int stepMinutes,
    int sourceSamples,
    List<ForecastPointDto> predictions,
    String note
) {}
