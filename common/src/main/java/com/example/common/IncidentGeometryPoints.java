package com.example.common;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.ArrayList;
import java.util.List;

public final class IncidentGeometryPoints {
    private IncidentGeometryPoints() {}

    public static List<double[]> geometryPoints(JsonNode geometry) {
        List<double[]> points = new ArrayList<>();
        if (geometry == null || geometry.isMissingNode()) return points;

        String type = geometry.path("type").asText("");
        JsonNode coordinates = geometry.path("coordinates");

        if ("Point".equals(type)) {
            addPoint(points, coordinates);
            return points;
        }
        if ("LineString".equals(type)) {
            for (JsonNode point : coordinates) addPoint(points, point);
            return points;
        }
        if ("MultiLineString".equals(type)) {
            for (JsonNode line : coordinates) {
                for (JsonNode point : line) addPoint(points, point);
            }
        }
        return points;
    }

    private static void addPoint(List<double[]> points, JsonNode coordinate) {
        if (!coordinate.isArray() || coordinate.size() < 2) return;
        points.add(new double[]{coordinate.get(1).asDouble(), coordinate.get(0).asDouble()});
    }
}
