package com.example.api_service.dto;

import java.time.OffsetDateTime;
import java.util.List;

public record TrafficSpeedZoneHistoryResponseDto(
    String corridor,
    OffsetDateTime since,
    int windowMinutes,
    int limit,
    int sampleCount,
    List<TrafficSpeedZoneSampleDto> samples
) {}
