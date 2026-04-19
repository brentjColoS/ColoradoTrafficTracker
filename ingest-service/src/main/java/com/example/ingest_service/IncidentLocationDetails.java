package com.example.ingest_service;

public record IncidentLocationDetails(
    String travelDirection,
    Double closestMileMarker,
    String mileMarkerMethod,
    Double mileMarkerConfidence,
    Double distanceToCorridorMeters,
    String locationLabel,
    Double centroidLat,
    Double centroidLon
) {}
