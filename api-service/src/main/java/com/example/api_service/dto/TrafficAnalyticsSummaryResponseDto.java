package com.example.api_service.dto;

import java.time.OffsetDateTime;
import java.util.List;

public record TrafficAnalyticsSummaryResponseDto(
    OffsetDateTime since,
    int windowHours,
    int corridorCount,
    List<CorridorAnalyticsSummaryDto> corridors
) {}
