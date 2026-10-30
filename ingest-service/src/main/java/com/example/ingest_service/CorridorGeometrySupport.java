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

    static double minDistanceMetersToPolyline(double lat, double lon, List<double[]> poly) {
        if (poly.size() < 2) return Double.POSITIVE_INFINITY;
        double min = Double.POSITIVE_INFINITY;
        for (int i = 0; i < poly.size() - 1; i++) {
            double[] a = poly.get(i), b = poly.get(i + 1);
            min = Math.min(min, distancePointToSegmentMeters(lat, lon, a[0], a[1], b[0], b[1]));
        }
        return min;
    }

    static double distancePointToSegmentMeters(double plat, double plon, double alat, double alon, double blat, double blon) {
        double lat0 = Math.toRadians(plat);
        double mLat = 111320.0;
        double mLon = 111320.0 * Math.cos(lat0);

        double ax = (alon - plon) * mLon, ay = (alat - plat) * mLat;
        double bx = (blon - plon) * mLon, by = (blat - plat) * mLat;

        double vectorx = bx - ax, vectory = by - ay;
        double len2 = vectorx * vectorx + vectory * vectory;
        if (len2 == 0) return Math.hypot(ax, ay);

        double t = -(ax * vectorx + ay * vectory) / len2;
        t = Math.max(0, Math.min(1, t));

        double px = ax + t * vectorx, py = ay + t * vectory;
        return Math.hypot(px, py);
    }
}
