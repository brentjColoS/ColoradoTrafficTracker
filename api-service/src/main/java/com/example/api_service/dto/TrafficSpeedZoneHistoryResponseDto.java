package com.example.api_service.dto;

import java.time.OffsetDateTime;
import java.util.List;

public record TrafficSpeedZoneHistoryResponseDto(
    String corridor,
    OffsetDateTime since,
    int windowMinutes,
    int limit,
    int returnedZoneRows,
    int returnedSnapshots,
    boolean truncated,
    int sampleCount,
    List<TrafficSpeedZoneSampleDto> samples
) {
    @Deprecated(since = "1.0", forRemoval = false)
    public int sampleCount() {
        return sampleCount;
    }
}
