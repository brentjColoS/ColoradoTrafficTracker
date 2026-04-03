package com.example.api_service.dto;

import com.example.api_service.TrafficSample;

public final class TrafficSampleMapper {
    private TrafficSampleMapper() {}

    public static TrafficSampleDto toDto(TrafficSample sample) {
        return new TrafficSampleDto(
            sample.getId(),
            sample.getCorridor(),
            sample.getAvgCurrentSpeed(),
            sample.getAvgFreeflowSpeed(),
            sample.getMinCurrentSpeed(),
            sample.getConfidence(),
            sample.getIncidentsJson(),
            sample.getPolledAt()
        );
    }
}
