package com.example.ingest_service;

import static com.example.ingest_service.CorridorGeometrySupport.minDistanceMetersToPolyline;
import java.util.List;
import java.util.Locale;
import java.util.Map;

final class TrafficTileFeatures {
    private TrafficTileFeatures() {}

    static boolean featureWithinBuffer(DecodedTrafficFeature feature, List<double[]> polyline, double bufferMeters) {
        if (polyline == null || polyline.size() < 2) return true;
        for (List<double[]> path : feature.paths()) {
            for (double[] point : path) {
                if (minDistanceMetersToPolyline(point[0], point[1], polyline) <= bufferMeters) return true;
            }
        }
        return false;
    }

    static List<double[]> firstPath(List<List<double[]>> paths) {
        for (List<double[]> path : paths) {
            if (path != null && !path.isEmpty()) return path;
        }
        return List.of();
    }

    static Double getDoubleTag(Map<String, Object> tags, String... keys) {
        for (String key : keys) {
            Object value = tags.get(key);
            if (value instanceof Number number) return number.doubleValue();
            if (value instanceof String text) {
                try {
                    return Double.parseDouble(text);
                } catch (NumberFormatException ignored) {
                    // Ignore non-numeric values.
                }
            }
        }
        return null;
    }

    static String getStringTag(Map<String, Object> tags, String... keys) {
        for (String key : keys) {
            Object value = tags.get(key);
            if (value != null) return String.valueOf(value);
        }
        return null;
    }

    static boolean isCorridorRoadType(String roadType) {
        if (roadType == null || roadType.isBlank()) return false;
        String r = roadType.trim().toLowerCase(Locale.ROOT);
        if (r.equals("0") || r.equals("1") || r.equals("2")) return true;
        return r.contains("motorway")
            || r.contains("international")
            || r.contains("major road")
            || r.equals("trunk")
            || r.equals("trunk_link")
            || r.equals("primary")
            || r.equals("primary_link");
    }
}
