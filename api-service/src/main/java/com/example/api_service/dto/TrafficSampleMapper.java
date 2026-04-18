package com.example.api_service.dto;

import com.example.api_service.TrafficSample;
import com.example.api_service.TrafficHistorySample;

public final class TrafficSampleMapper {
    private TrafficSampleMapper() {}

    public static TrafficSampleDto toDto(TrafficSample sample) {
        return new TrafficSampleDto(
            sample.getId(),
            sample.getId(),
            sample.getCorridor(),
            sample.getSourceMode(),
            sample.getAvgCurrentSpeed(),
            sample.getAvgFreeflowSpeed(),
            sample.getMinCurrentSpeed(),
            sample.getConfidence(),
            sample.getIncidentsJson(),
            sample.getPolledAt(),
            false,
            null
        );
    }

    public static TrafficSampleDto toDto(TrafficHistorySample sample) {
        return new TrafficSampleDto(
            sample.getHistoryId(),
            sample.getSampleRefId(),
            sample.getCorridor(),
            sample.getSourceMode(),
            sample.getAvgCurrentSpeed(),
            sample.getAvgFreeflowSpeed(),
            sample.getMinCurrentSpeed(),
            sample.getConfidence(),
            sample.getIncidentsJson(),
            sample.getPolledAt(),
            sample.getIsArchived(),
            sample.getArchivedAt()
        );
    }
}
