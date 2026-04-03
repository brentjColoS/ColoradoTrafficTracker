package com.example.api_service.dto;

import java.time.OffsetDateTime;
import java.util.List;

public record TrafficHistoryResponseDto(
    String corridor,
    OffsetDateTime since,
    int windowMinutes,
    int limit,
    int returned,
    List<TrafficSampleDto> samples
) {}
