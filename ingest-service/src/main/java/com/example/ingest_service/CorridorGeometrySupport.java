package com.example.ingest_service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

public final class CorridorGeometrySupport {
    private static final ObjectMapper MAPPER = new ObjectMapper();

    private CorridorGeometrySupport() {}

    public static String toGeoJsonLineString(List<double[]> polyline) {
        if (polyline == null || polyline.size() < 2) return null;

        List<String> coordinates = new ArrayList<>();
        for (double[] point : polyline) {
            if (point == null || point.length < 2) continue;
            coordinates.add(String.format(Locale.US, "[%.6f,%.6f]", point[1], point[0]));
        }
        if (coordinates.size() < 2) return null;
        return "{\"type\":\"LineString\",\"coordinates\":[" + String.join(",", coordinates) + "]}";
    }

    public static String fallbackGeoJsonFromBbox(String bbox, String primaryDirection, String secondaryDirection) {
        double[] normalized = parseBbox(bbox);
        if (normalized == null) return null;

        double minLat = normalized[0];
        double minLon = normalized[1];
        double maxLat = normalized[2];
        double maxLon = normalized[3];
        double centerLat = (minLat + maxLat) / 2.0;
        double centerLon = (minLon + maxLon) / 2.0;

        String orientation = dominantOrientation(primaryDirection, secondaryDirection);
        List<double[]> line = new ArrayList<>(2);
        if ("NS".equals(orientation)) {
            line.add(new double[]{maxLat, centerLon});
            line.add(new double[]{minLat, centerLon});
        } else if ("EW".equals(orientation)) {
            line.add(new double[]{centerLat, minLon});
            line.add(new double[]{centerLat, maxLon});
        } else {
            line.add(new double[]{maxLat, minLon});
            line.add(new double[]{minLat, maxLon});
        }
        return toGeoJsonLineString(line);
    }

    public static List<double[]> pointsFromGeoJson(String geometryJson) {
        if (geometryJson == null || geometryJson.isBlank()) return List.of();

        try {
            JsonNode geometry = MAPPER.readTree(geometryJson);
            if (!"LineString".equals(geometry.path("type").asText())) {
                return List.of();
            }

            JsonNode coordinates = geometry.path("coordinates");
            if (!coordinates.isArray()) {
                return List.of();
            }

            List<double[]> points = new ArrayList<>();
            for (JsonNode coordinate : coordinates) {
                if (!coordinate.isArray() || coordinate.size() < 2) continue;
                points.add(new double[]{coordinate.get(1).asDouble(), coordinate.get(0).asDouble()});
            }
            return points.size() < 2 ? List.of() : points;
        } catch (Exception ex) {
            return List.of();
        }
    }

    private static double[] parseBbox(String bbox) {
        if (bbox == null || bbox.isBlank()) return null;
        String[] parts = bbox.split(",");
        if (parts.length != 4) return null;

        double lat1 = Double.parseDouble(parts[0].trim());
        double lon1 = Double.parseDouble(parts[1].trim());
        double lat2 = Double.parseDouble(parts[2].trim());
        double lon2 = Double.parseDouble(parts[3].trim());
        return new double[]{
            Math.min(lat1, lat2),
            Math.min(lon1, lon2),
            Math.max(lat1, lat2),
            Math.max(lon1, lon2)
        };
    }

    private static String dominantOrientation(String primaryDirection, String secondaryDirection) {
        String primary = normalizeDirection(primaryDirection);
        String secondary = normalizeDirection(secondaryDirection);
        if ("N".equals(primary) || "S".equals(primary) || "N".equals(secondary) || "S".equals(secondary)) {
            return "NS";
        }
        if ("E".equals(primary) || "W".equals(primary) || "E".equals(secondary) || "W".equals(secondary)) {
            return "EW";
        }
        return "DIAGONAL";
    }

    private static String normalizeDirection(String direction) {
        if (direction == null || direction.isBlank()) return null;
        return direction.trim().toUpperCase(Locale.ROOT);
    }

    static double haversineMeters(double lat1, double lon1, double lat2, double lon2) {
        double r = 6371008.8;
        double dLat = Math.toRadians(lat2 - lat1);
        double dLon = Math.toRadians(lon2 - lon1);
        double a = Math.sin(dLat / 2) * Math.sin(dLat / 2)
            + Math.cos(Math.toRadians(lat1)) * Math.cos(Math.toRadians(lat2))
            * Math.sin(dLon / 2) * Math.sin(dLon / 2);
        return 2 * r * Math.asin(Math.sqrt(a));
    }
}
