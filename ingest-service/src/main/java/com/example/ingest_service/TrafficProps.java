package com.example.ingest_service;

import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties(prefix = "traffic")
public record TrafficProps(
    String tomtomApiKey,
    int pollSeconds,
    String mode,
    int tileZoom,
    int tileConcurrency,
    double tileRouteBufferMeters,
    int tileQuotaTargetDailyRequests,
    int tileQuotaAdaptiveCapDailyRequests,
    int tileQuotaHardStopDailyRequests
) {
    public static final String MODE_TILE = "tile";

    public static record Corridor(
        String name,
        String displayName,
        String roadNumber,
        String primaryDirection,
        String secondaryDirection,
        Double startMileMarker,
        Double endMileMarker,
        String bbox
    ) {}

    public boolean useTileMode() {
        return MODE_TILE.equalsIgnoreCase(mode);
    }
}
