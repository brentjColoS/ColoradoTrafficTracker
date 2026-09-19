package com.example.api_service.dto;

import java.time.OffsetDateTime;
import java.util.List;

public record TrafficBaselineResponseDto(
    String corridor,
    OffsetDateTime weekStart,
    OffsetDateTime historySince,
    int lookbackWeeks,
    int recencyHalfLifeWeeks,
    int profileCount,
    List<TrafficBaselineProfileDto> profiles
) {}
