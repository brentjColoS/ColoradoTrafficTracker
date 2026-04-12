package com.example.ingest_service;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

public final class CorridorGeometrySupport {
    private CorridorGeometrySupport() {}

    public static String toGeoJsonLineString(List<double[]> polyline) {
        if (polyline == null || polyline.size() < 2) return null;

        StringBuilder out = new StringBuilder();
        out.append("{\"type\":\"LineString\",\"coordinates\":[");
        for (int i = 0; i < polyline.size(); i++) {
            double[] point = polyline.get(i);
            if (point == null || point.length < 2) continue;
            if (i > 0) out.append(',');
            out.append('[')
                .append(format(point[1]))
                .append(',')
                .append(format(point[0]))
                .append(']');
        }
        out.append("]}");
        return out.toString();
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

    private static String format(double value) {
        return String.format(Locale.US, "%.6f", value);
    }
}
