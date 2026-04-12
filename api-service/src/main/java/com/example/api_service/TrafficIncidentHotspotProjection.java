package com.example.api_service;

import java.time.OffsetDateTime;

public interface TrafficIncidentHotspotProjection {
    String getCorridor();
    String getTravelDirection();
    Integer getMileMarkerBand();
    Long getIncidentCount();
    Double getAvgDelaySeconds();
    Integer getMaxDelaySeconds();
    OffsetDateTime getFirstSeenAt();
    OffsetDateTime getLastSeenAt();
    Long getArchivedIncidentCount();
}
