package com.example.api_service.dto;

import com.fasterxml.jackson.annotation.JsonInclude;
import java.time.OffsetDateTime;
import java.util.List;

public record DashboardChartHistoryDto(
    String corridor, OffsetDateTime since, int windowMinutes, int limit, int returned,
    List<Sample> samples
) {
    public static DashboardChartHistoryDto from(TrafficHistoryResponseDto history) {
        return new DashboardChartHistoryDto(history.corridor(), history.since(), history.windowMinutes(),
            history.limit(), history.returned(), history.samples().stream().map(Sample::from).toList());
    }

    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record Sample(
        String sourceMode, Double avgCurrentSpeed, Double avgFreeflowSpeed, Double minCurrentSpeed,
        Double confidence, Integer speedSampleCount, Double p10Speed, Double p50Speed, Double p90Speed,
        String speedStateSignature, Integer incidentCount, OffsetDateTime polledAt
    ) {
        static Sample from(TrafficSampleDto sample) {
            return new Sample(sample.sourceMode(), sample.avgCurrentSpeed(), sample.avgFreeflowSpeed(),
                sample.minCurrentSpeed(), sample.confidence(), sample.speedSampleCount(), sample.p10Speed(),
                sample.p50Speed(), sample.p90Speed(), sample.speedStateSignature(), sample.incidentCount(), sample.polledAt());
        }
    }
}
