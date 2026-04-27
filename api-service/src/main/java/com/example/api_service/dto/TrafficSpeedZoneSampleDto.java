package com.example.api_service.dto;

import java.time.OffsetDateTime;

public record TrafficSpeedZoneSampleDto(
    Long id,
    Long sampleId,
    String corridor,
    String zoneKey,
    Integer zoneOrder,
    String zoneLabel,
    String zoneDescription,
    Double startMileMarker,
    Double endMileMarker,
    Integer postedSpeedMph,
    Double avgCurrentSpeed,
    Double minCurrentSpeed,
    Double speedStddev,
    Double p10Speed,
    Double p50Speed,
    Double p90Speed,
    Integer speedSampleCount,
    String speedStateSignature,
    OffsetDateTime polledAt
) {}
