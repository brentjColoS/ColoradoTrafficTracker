package com.example.api_service.dto;

import java.time.Instant;

public record TrafficSpeedZoneTrendPointDto(
    String zoneKey,
    Integer zoneOrder,
    String zoneLabel,
    String zoneDescription,
    Double startMileMarker,
    Double endMileMarker,
    Integer postedSpeedMph,
    Instant bucketStart,
    Double avgCurrentSpeed,
    Double minCurrentSpeed,
    Long observationCount
) {}
