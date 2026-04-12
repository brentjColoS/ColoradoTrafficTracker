package com.example.routes_service;

import org.springframework.boot.context.properties.ConfigurationProperties;

import java.util.List;

@ConfigurationProperties(prefix = "routes")
public record RoutesProps(List<Corridor> corridors) {
    public static record Corridor(
        String name,
        String displayName,
        String roadNumber,
        String primaryDirection,
        String secondaryDirection,
        Double startMileMarker,
        Double endMileMarker,
        String bbox,
        String geometryJson
    ) {}
}
