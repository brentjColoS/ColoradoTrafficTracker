package com.example.ingest_service;

import org.springframework.boot.context.properties.ConfigurationProperties;

import java.util.LinkedHashSet;
import java.util.Locale;
import java.util.Set;

@ConfigurationProperties(prefix = "traffic")
public record TrafficProps(
    String tomtomApiKey,
    int pollSeconds,
    String mode,
    int tileZoom,
    String tileCorridorZoomOverrides,
    String tileValidatedCorridors,
    int tileValidationSamplePoints,
    int tileConcurrency,
    double tileRouteBufferMeters,
    double tileSpeedRouteBufferMeters,
    int tileQuotaTargetDailyRequests,
    int tileQuotaAdaptiveCapDailyRequests,
    int tileQuotaHardStopDailyRequests,
    boolean startupValidationEnabled
) {
    public static final String MODE_TILE = "tile";

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
        java.util.List<MileMarkerAnchor> mileMarkerAnchors,
        String bbox,
        String geometryJson,
        String geometryResource,
        Double maxSnapDistanceMeters
    ) {}

    public boolean useTileMode() {
        return MODE_TILE.equalsIgnoreCase(mode);
    }

    public Set<String> tileValidatedCorridorSet() {
        if (tileValidatedCorridors == null || tileValidatedCorridors.isBlank()) return Set.of();

        Set<String> corridors = new LinkedHashSet<>();
        for (String token : tileValidatedCorridors.split(",")) {
            String corridor = token == null ? "" : token.trim().toUpperCase(Locale.ROOT);
            if (!corridor.isBlank()) corridors.add(corridor);
        }
        return Set.copyOf(corridors);
    }

    public boolean usesValidatedTileSpeed(String corridorName) {
        if (corridorName == null || corridorName.isBlank()) return false;
        return tileValidatedCorridorSet().contains(corridorName.trim().toUpperCase(Locale.ROOT));
    }

    public int validationSamplePointsForCorridor(String corridorName) {
        if (!usesValidatedTileSpeed(corridorName)) return 0;
        return tileValidationSamplePoints > 0 ? tileValidationSamplePoints : 4;
    }
}
