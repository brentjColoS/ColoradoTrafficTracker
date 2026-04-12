package com.example.api_service.dto;

import java.time.OffsetDateTime;
import java.util.List;

public record TrafficHotspotResponseDto(
    String corridor,
    OffsetDateTime since,
    int windowHours,
    int returned,
    List<IncidentHotspotDto> hotspots
) {}
