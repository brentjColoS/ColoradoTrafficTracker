package com.example.api_service.dto;

import java.util.List;

public record TrafficSpeedZoneBaselineDto(
    String zoneKey,
    Integer zoneOrder,
    String zoneLabel,
    Double startMileMarker,
    Double endMileMarker,
    Integer postedSpeedMph,
    int profileCount,
    List<TrafficBaselineProfileDto> profiles
) {}
