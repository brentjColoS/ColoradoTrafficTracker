package com.example.ingest_service;

import java.util.List;
import java.util.Map;
import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties(prefix = "traffic")
public record TrafficProps(
    String tomtomApiKey,
    int pollSeconds,
    String mode,
    int tileZoom,
    String tileCorridorZoomOverrides,
    int tileConcurrency,
    double tileRouteBufferMeters,
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
        List<MileMarkerAnchor> mileMarkerAnchors,
        String bbox,
        String geometryJson,
        String geometryResource,
        Double maxSnapDistanceMeters,
        Map<String, List<double[]>> directionalRoutes
    ) {
        public Corridor(
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
            String geometryResource,
            Double maxSnapDistanceMeters
        ) {
            this(
                name,
                displayName,
                roadNumber,
                primaryDirection,
                secondaryDirection,
                startMileMarker,
                endMileMarker,
                mileMarkerAnchors,
                bbox,
                geometryJson,
                geometryResource,
                maxSnapDistanceMeters,
                Map.of()
            );
        }

        Corridor withDirectionalRoutes(Map<String, List<double[]>> routes) {
            return new Corridor(
                name,
                displayName,
                roadNumber,
                primaryDirection,
                secondaryDirection,
                startMileMarker,
                endMileMarker,
                mileMarkerAnchors,
                bbox,
                geometryJson,
                geometryResource,
                maxSnapDistanceMeters,
                routes == null ? Map.of() : routes
            );
        }
    }

    public boolean useTileMode() {
        return MODE_TILE.equalsIgnoreCase(mode);
    }
}
