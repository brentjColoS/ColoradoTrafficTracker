package com.example.api_service.dto;

import java.time.OffsetDateTime;
import java.util.List;

public record TrafficAnomalyResponseDto(
    String corridor,
    OffsetDateTime since,
    int windowMinutes,
    int baselineMinutes,
    double zThreshold,
    double minimumDropMph,
    int groupGapMinutes,
    int baselineCount,
    Double baselineMeanSpeed,
    Double baselineStdDev,
    int checkedSamples,
    int anomalyCount,
    int anomalySampleCount,
    int slowdownEventCount,
    List<AnomalySampleDto> anomalies,
    List<TrafficSlowdownEventDto> slowdownEvents,
    String note
) {}
