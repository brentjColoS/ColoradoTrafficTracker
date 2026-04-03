package com.example.api_service.dto;

import java.time.OffsetDateTime;
import java.util.List;

public record TrafficAnomalyResponseDto(
    String corridor,
    OffsetDateTime since,
    int windowMinutes,
    int baselineMinutes,
    double zThreshold,
    int baselineCount,
    Double baselineMeanSpeed,
    Double baselineStdDev,
    int checkedSamples,
    int anomalyCount,
    List<AnomalySampleDto> anomalies,
    String note
) {}
