package com.example.api_service;

import java.time.Instant;

public interface TrafficIncidentHotspotProjection {
    String getCorridor();
    String getTravelDirection();
    Integer getMileMarkerBand();
    Long getObservationCount();
    Long getIncidentCount();
    Double getAvgDelaySeconds();
    Integer getMaxDelaySeconds();
    Instant getFirstSeenAt();
    Instant getLastSeenAt();
    Long getArchivedObservationCount();
    Long getArchivedIncidentCount();
}
