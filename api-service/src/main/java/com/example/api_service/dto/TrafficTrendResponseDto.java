package com.example.api_service.dto;

import java.time.OffsetDateTime;
import java.util.List;

public record TrafficTrendResponseDto(
    String corridor,
    OffsetDateTime since,
    int windowHours,
    int returned,
    List<CorridorTrendPointDto> buckets
) {}
