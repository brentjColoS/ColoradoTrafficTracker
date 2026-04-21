package com.example.routes_service;

import org.springframework.boot.context.properties.ConfigurationProperties;

import java.util.List;

@ConfigurationProperties(prefix = "routes")
public record RoutesProps(List<Corridor> corridors) {
    public static record MileMarkerAnchor(
        String label,
        Double mileMarker,
        Double latitude,
        Double longitude
    ) {}

    public static record Corridor(
        String name,
        String displayName,
        String roadNumber,
        String primaryDirection,
        String secondaryDirection,
        Double startMileMarker,
        Double endMileMarker,
        List<MileMarkerAnchor> mileMarkerAnchors,
        String bbox,
        String geometryJson,
        Double maxSnapDistanceMeters
    ) {}
}
