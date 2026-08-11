package com.example.api_service;

import java.time.Instant;

public interface CurrentIncidentProjection {
    Long getEventId();
    String getProvider();
    String getProduct();
    String getProviderEventId();
    String getSourceStatus();
    String getNormalizedStatus();
    String getSourceCategory();
    String getNormalizedCategory();
    String getIncidentDescription();
    String getGeometryType();
    String getGeometryJson();
    Instant getSourceStartedAt();
    Instant getSourceEndedAt();
    Instant getSourceUpdatedAt();
    Instant getFirstSeenAt();
    Instant getLastSeenAt();
    String getRawEventJson();
    String getCorridor();
    String getRoadNumber();
    String getTravelDirection();
    Double getClosestMileMarker();
    String getMileMarkerMethod();
    Double getMileMarkerConfidence();
    Double getDistanceToCorridorMeters();
    String getLocationLabel();
    Double getCentroidLat();
    Double getCentroidLon();
}
