package com.example.api_service.dto;

import java.time.OffsetDateTime;
import java.util.List;

public record TrafficSpeedZoneBaselineResponseDto(
    String corridor,
    OffsetDateTime weekStart,
    OffsetDateTime historySince,
    int lookbackWeeks,
    int recencyHalfLifeWeeks,
    int zoneCount,
    List<TrafficSpeedZoneBaselineDto> zones
) {}
