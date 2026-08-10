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
            sample.getSpeedSampleCount(),
            sample.getSpeedStddev(),
            sample.getP10Speed(),
            sample.getP50Speed(),
            sample.getP90Speed(),
            sample.getSpeedStateSignature(),
            sample.getSemanticFlowSignature(),
            sample.getLocalizedSlowdown(),
            sample.getLocalizedSlowdownNote(),
            sample.getFlowProvider(),
            sample.getFlowProduct(),
            sample.getFlowSourceZoom(),
            sample.getFlowRequestedCadenceSeconds(),
            sample.getIncidentProvider(),
            sample.getIncidentProduct(),
            sample.getIncidentFetchedAt(),
            sample.getIncidentSourceUpdatedAt(),
            sample.getIncidentRequestedCadenceSeconds(),
            sample.getIncidentCount(),
            sample.getIncidentsJson(),
            sample.getPolledAt(),
            false,
            null
        );
    }

    public static TrafficSampleDto toDto(TrafficHistorySample sample) {
        return toDto(sample, true);
    }

    public static TrafficSampleDto toDto(TrafficHistorySample sample, boolean includeIncidents) {
        return new TrafficSampleDto(
            sample.getHistoryId(),
            sample.getSampleRefId(),
            sample.getCorridor(),
            sample.getSourceMode(),
            sample.getAvgCurrentSpeed(),
            sample.getAvgFreeflowSpeed(),
            sample.getMinCurrentSpeed(),
            sample.getConfidence(),
            sample.getSpeedSampleCount(),
            sample.getSpeedStddev(),
            sample.getP10Speed(),
            sample.getP50Speed(),
            sample.getP90Speed(),
            sample.getSpeedStateSignature(),
            sample.getSemanticFlowSignature(),
            sample.getLocalizedSlowdown(),
            sample.getLocalizedSlowdownNote(),
            sample.getFlowProvider(),
            sample.getFlowProduct(),
            sample.getFlowSourceZoom(),
            sample.getFlowRequestedCadenceSeconds(),
            sample.getIncidentProvider(),
            sample.getIncidentProduct(),
            sample.getIncidentFetchedAt(),
            sample.getIncidentSourceUpdatedAt(),
            sample.getIncidentRequestedCadenceSeconds(),
            sample.getIncidentCount(),
            includeIncidents ? sample.getIncidentsJson() : null,
            sample.getPolledAt(),
            sample.getIsArchived(),
            sample.getArchivedAt()
        );
    }
}
