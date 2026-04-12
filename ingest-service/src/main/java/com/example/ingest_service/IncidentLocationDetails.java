package com.example.ingest_service;

public record IncidentLocationDetails(
    String travelDirection,
    Double closestMileMarker,
    String locationLabel,
    Double centroidLat,
    Double centroidLon
) {}
