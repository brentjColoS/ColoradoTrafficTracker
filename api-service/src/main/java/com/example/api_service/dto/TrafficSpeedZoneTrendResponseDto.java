package com.example.api_service.dto;

import java.time.Instant;
import java.util.List;

public record TrafficSpeedZoneTrendResponseDto(
    String corridor,
    Instant windowStart,
    Instant windowEnd,
    int windowHours,
    int bucketMinutes,
    int returned,
    int availableBucketCount,
    Instant firstObservedAt,
    Instant lastObservedAt,
    List<TrafficSpeedZoneTrendPointDto> points
) {}
