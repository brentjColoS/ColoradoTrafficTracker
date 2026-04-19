package com.example.api_service.dto;

import java.time.OffsetDateTime;
import java.util.List;

public record MileMarkerAssessmentResponseDto(
    OffsetDateTime since,
    int windowHours,
    int corridorCount,
    List<MileMarkerCorridorAssessmentDto> corridors
) {}
