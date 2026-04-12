package com.example.ingest_service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

public final class IncidentLocationEnricher {
    private IncidentLocationEnricher() {}

    public static ObjectNode enrichIncident(
        ObjectNode incident,
        TrafficProps.Corridor corridor,
        List<double[]> corridorPolyline
    ) {
        if (incident == null) return null;

        IncidentLocationDetails details = resolveDetails(incident, corridor, corridorPolyline);
        ObjectNode copy = incident.deepCopy();
        ObjectNode props = copy.withObject("/properties");

        if (details.travelDirection() != null) props.put("travelDirection", details.travelDirection());
        if (details.closestMileMarker() != null) props.put("closestMileMarker", details.closestMileMarker());
        if (details.locationLabel() != null) props.put("locationLabel", details.locationLabel());
        if (details.centroidLat() != null) props.put("centroidLat", details.centroidLat());
        if (details.centroidLon() != null) props.put("centroidLon", details.centroidLon());

        return copy;
    }

    static IncidentLocationDetails resolveDetails(
        JsonNode incident,
        TrafficProps.Corridor corridor,
        List<double[]> corridorPolyline
    ) {
        List<double[]> geometryPoints = geometryPoints(incident.path("geometry"));
        if (geometryPoints.isEmpty()) {
            return new IncidentLocationDetails(
                normalizeDirection(corridor.primaryDirection()),
                null,
                buildLocationLabel(corridor, normalizeDirection(corridor.primaryDirection()), null),
                null,
                null
            );
        }

        double[] centroid = centroid(geometryPoints);
        String direction = inferDirection(geometryPoints, corridor);
        Double mileMarker = interpolateMileMarker(corridor, corridorPolyline, centroid[0], centroid[1]);

        return new IncidentLocationDetails(
            direction,
            mileMarker,
            buildLocationLabel(corridor, direction, mileMarker),
            centroid[0],
            centroid[1]
        );
    }

    private static String buildLocationLabel(TrafficProps.Corridor corridor, String direction, Double mileMarker) {
        String roadNumber = corridor.roadNumber() != null && !corridor.roadNumber().isBlank()
            ? corridor.roadNumber().trim()
            : corridor.name();
        String directionLabel = toDirectionLabel(direction);
        if (mileMarker != null && directionLabel != null) {
            return String.format(Locale.US, "%s %s near MM %.1f", roadNumber, directionLabel, mileMarker);
        }
        if (mileMarker != null) {
            return String.format(Locale.US, "%s near MM %.1f", roadNumber, mileMarker);
        }
        if (directionLabel != null) {
            return roadNumber + " " + directionLabel;
        }
        return roadNumber;
    }

    private static String inferDirection(List<double[]> points, TrafficProps.Corridor corridor) {
        if (points.size() < 2) return normalizeDirection(corridor.primaryDirection());

        double[] first = points.get(0);
        double[] last = points.get(points.size() - 1);
        double latDelta = last[0] - first[0];
        double lonDelta = last[1] - first[1];

        String rawDirection;
        if (Math.abs(latDelta) >= Math.abs(lonDelta)) {
            rawDirection = latDelta >= 0 ? "N" : "S";
        } else {
            rawDirection = lonDelta >= 0 ? "E" : "W";
        }

        String primary = normalizeDirection(corridor.primaryDirection());
        String secondary = normalizeDirection(corridor.secondaryDirection());
        if (rawDirection.equals(primary) || rawDirection.equals(secondary)) return rawDirection;
        if (primary != null && secondary == null) return primary;
        return rawDirection;
    }

    private static Double interpolateMileMarker(
        TrafficProps.Corridor corridor,
        List<double[]> corridorPolyline,
        double lat,
        double lon
    ) {
        if (corridor.startMileMarker() == null || corridor.endMileMarker() == null) return null;
        if (corridorPolyline == null || corridorPolyline.size() < 2) return null;

        double[] cumulative = cumulativeDistances(corridorPolyline);
        double totalMeters = cumulative[cumulative.length - 1];
        if (totalMeters <= 0.0) return null;

        double projectedMeters = projectedDistanceAlongPolyline(lat, lon, corridorPolyline, cumulative);
        double fraction = Math.max(0.0, Math.min(1.0, projectedMeters / totalMeters));
        return corridor.startMileMarker() + (fraction * (corridor.endMileMarker() - corridor.startMileMarker()));
    }

    private static double projectedDistanceAlongPolyline(double lat, double lon, List<double[]> polyline, double[] cumulative) {
        double bestDistance = Double.POSITIVE_INFINITY;
        double bestProjectionMeters = 0.0;

        for (int i = 0; i < polyline.size() - 1; i++) {
            double[] start = polyline.get(i);
            double[] end = polyline.get(i + 1);
            SegmentProjection projection = projectOntoSegment(lat, lon, start, end);
            if (projection.distanceMeters() < bestDistance) {
                bestDistance = projection.distanceMeters();
                double segmentMeters = cumulative[i + 1] - cumulative[i];
                bestProjectionMeters = cumulative[i] + (projection.t() * segmentMeters);
            }
        }

        return bestProjectionMeters;
    }

    private static SegmentProjection projectOntoSegment(double plat, double plon, double[] start, double[] end) {
        double lat0 = Math.toRadians(plat);
        double mLat = 111320.0;
        double mLon = 111320.0 * Math.cos(lat0);

        double ax = (start[1] - plon) * mLon;
        double ay = (start[0] - plat) * mLat;
        double bx = (end[1] - plon) * mLon;
        double by = (end[0] - plat) * mLat;

        double vectorX = bx - ax;
        double vectorY = by - ay;
        double len2 = (vectorX * vectorX) + (vectorY * vectorY);
        if (len2 == 0.0) return new SegmentProjection(Math.hypot(ax, ay), 0.0);

        double t = -(ax * vectorX + ay * vectorY) / len2;
        t = Math.max(0.0, Math.min(1.0, t));

        double px = ax + (t * vectorX);
        double py = ay + (t * vectorY);
        return new SegmentProjection(Math.hypot(px, py), t);
    }

    private static List<double[]> geometryPoints(JsonNode geometry) {
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

    private static double[] centroid(List<double[]> points) {
        double latSum = 0.0;
        double lonSum = 0.0;
        for (double[] point : points) {
            latSum += point[0];
            lonSum += point[1];
        }
        return new double[]{latSum / points.size(), lonSum / points.size()};
    }

    private static double[] cumulativeDistances(List<double[]> polyline) {
        double[] cumulative = new double[polyline.size()];
        cumulative[0] = 0.0;
        for (int i = 1; i < polyline.size(); i++) {
            double[] previous = polyline.get(i - 1);
            double[] current = polyline.get(i);
            cumulative[i] = cumulative[i - 1] + haversineMeters(previous[0], previous[1], current[0], current[1]);
        }
        return cumulative;
    }

    private static double haversineMeters(double lat1, double lon1, double lat2, double lon2) {
        double r = 6371008.8;
        double dLat = Math.toRadians(lat2 - lat1);
        double dLon = Math.toRadians(lon2 - lon1);
        double a = Math.sin(dLat / 2) * Math.sin(dLat / 2)
            + Math.cos(Math.toRadians(lat1)) * Math.cos(Math.toRadians(lat2))
            * Math.sin(dLon / 2) * Math.sin(dLon / 2);
        return 2 * r * Math.asin(Math.sqrt(a));
    }

    private static String normalizeDirection(String direction) {
        if (direction == null || direction.isBlank()) return null;
        return direction.trim().toUpperCase(Locale.ROOT);
    }

    private static String toDirectionLabel(String direction) {
        return switch (normalizeDirection(direction)) {
            case "N" -> "northbound";
            case "S" -> "southbound";
            case "E" -> "eastbound";
            case "W" -> "westbound";
            default -> null;
        };
    }

    private record SegmentProjection(double distanceMeters, double t) {}
}
