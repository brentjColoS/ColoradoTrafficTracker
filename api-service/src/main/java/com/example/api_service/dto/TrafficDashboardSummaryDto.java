package com.example.api_service.dto;

import java.time.OffsetDateTime;
import java.util.List;

public record TrafficDashboardSummaryDto(
    String corridor,
    OffsetDateTime generatedAt,
    int summaryWindowHours,
    int recentIncidentWindowMinutes,
    TrafficProviderGuardStatusDto providerStatus,
    TrafficSampleDto latest,
    CorridorAnalyticsSummaryDto corridorSummary,
    IncidentHotspotDto topHotspot,
    Integer sampleAgeMinutes,
    Double speedDeltaFromWindowAverage,
    Long recentIncidentObservationCount,
    Long recentIncidentReferenceCount,
    Long recentMissingMileMarkerCount,
    List<String> notes
) {}
