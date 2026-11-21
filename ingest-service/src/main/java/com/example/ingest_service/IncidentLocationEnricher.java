package com.example.ingest_service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Locale;

public final class IncidentLocationEnricher {
    private static final double DEFAULT_MAX_SNAP_DISTANCE_METERS = 400.0;

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
        if (details.mileMarkerMethod() != null) props.put("mileMarkerMethod", details.mileMarkerMethod());
        if (details.mileMarkerConfidence() != null) props.put("mileMarkerConfidence", details.mileMarkerConfidence());
        if (details.distanceToCorridorMeters() != null) props.put("distanceToCorridorMeters", details.distanceToCorridorMeters());
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
                "direction_only",
                0.30,
                null,
                buildLocationLabel(corridor, normalizeDirection(corridor.primaryDirection()), null),
                null,
                null
            );
        }

        double[] centroid = centroid(geometryPoints);
        double[] cumulative = corridorPolyline == null || corridorPolyline.size() < 2
            ? null
            : cumulativeDistances(corridorPolyline);
        String direction = inferDirection(geometryPoints, corridor, corridorPolyline, cumulative);
        MileMarkerResolution resolution = resolveMileMarker(corridor, corridorPolyline, cumulative, centroid[0], centroid[1]);

        return new IncidentLocationDetails(
            direction,
            resolution.closestMileMarker(),
            resolution.method(),
            resolution.confidence(),
            resolution.distanceToCorridorMeters(),
            buildLocationLabel(corridor, direction, resolution.closestMileMarker()),
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

    private static String inferDirection(
        List<double[]> points,
        TrafficProps.Corridor corridor,
        List<double[]> corridorPolyline,
        double[] cumulative
    ) {
        String primary = normalizeDirection(corridor.primaryDirection());
        String secondary = normalizeDirection(corridor.secondaryDirection());
        if (points.size() < 2) return normalizeDirection(corridor.primaryDirection());

        CorridorAxis axis = corridorAxis(primary, secondary, corridorPolyline);
        String projectedDirection = inferProjectedDirection(points, corridorPolyline, cumulative, axis, primary, secondary);
        if (projectedDirection != null) {
            return projectedDirection;
        }

        String rawDirection = inferAxisConstrainedDirection(points.get(0), points.get(points.size() - 1), axis);

        if (rawDirection.equals(primary) || rawDirection.equals(secondary)) return rawDirection;
        if (primary != null && secondary == null) return primary;
        if (primary != null && secondary != null) return primary;
        return rawDirection;
    }

    private static MileMarkerResolution resolveMileMarker(
        TrafficProps.Corridor corridor,
        List<double[]> corridorPolyline,
        double[] cumulative,
        double lat,
        double lon
    ) {
        if (corridorPolyline == null || corridorPolyline.size() < 2) {
            return new MileMarkerResolution(null, "direction_only", 0.30, null);
        }

        double maxSnapDistanceMeters = maxSnapDistanceMeters(corridor);
        if (cumulative == null || cumulative.length != corridorPolyline.size()) {
            cumulative = cumulativeDistances(corridorPolyline);
        }
        double totalMeters = cumulative[cumulative.length - 1];
        if (totalMeters <= 0.0) {
            return new MileMarkerResolution(null, "direction_only", 0.30, null);
        }

        ProjectionMatch match = projectedDistanceAlongPolyline(lat, lon, corridorPolyline, cumulative);
        if (match.distanceToCorridorMeters() > maxSnapDistanceMeters) {
            return new MileMarkerResolution(null, "off_corridor", 0.15, roundToSingleDecimal(match.distanceToCorridorMeters()));
        }

        List<AnchorProjection> configuredAnchors = projectConfiguredAnchors(
            corridor.mileMarkerAnchors(),
            corridorPolyline,
            cumulative,
            maxSnapDistanceMeters
        );
        if (configuredAnchors.size() >= 2) {
            Double anchoredMarker = interpolateFromAnchors(match.projectedMeters(), configuredAnchors);
            if (anchoredMarker != null) {
                return new MileMarkerResolution(
                    roundToSingleDecimal(anchoredMarker),
                    "anchor_interpolated",
                    confidenceFor("anchor_interpolated", match.distanceToCorridorMeters(), maxSnapDistanceMeters),
                    roundToSingleDecimal(match.distanceToCorridorMeters())
                );
            }
        }

        if (corridor.startMileMarker() != null && corridor.endMileMarker() != null) {
            double fraction = Math.max(0.0, Math.min(1.0, match.projectedMeters() / totalMeters));
            double marker = corridor.startMileMarker() + (fraction * (corridor.endMileMarker() - corridor.startMileMarker()));
            return new MileMarkerResolution(
                roundToSingleDecimal(marker),
                "range_interpolated",
                confidenceFor("range_interpolated", match.distanceToCorridorMeters(), maxSnapDistanceMeters),
                roundToSingleDecimal(match.distanceToCorridorMeters())
            );
        }

        return new MileMarkerResolution(null, "direction_only", 0.30, roundToSingleDecimal(match.distanceToCorridorMeters()));
    }

    private static ProjectionMatch projectedDistanceAlongPolyline(double lat, double lon, List<double[]> polyline, double[] cumulative) {
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

        return new ProjectionMatch(bestProjectionMeters, bestDistance);
    }

    private static List<AnchorProjection> projectConfiguredAnchors(
        List<TrafficProps.MileMarkerAnchor> anchors,
        List<double[]> corridorPolyline,
        double[] cumulative,
        double maxSnapDistanceMeters
    ) {
        if (anchors == null || anchors.isEmpty()) {
            return List.of();
        }

        List<AnchorProjection> projected = new ArrayList<>();
        for (TrafficProps.MileMarkerAnchor anchor : anchors) {
            if (anchor == null || anchor.mileMarker() == null || anchor.latitude() == null || anchor.longitude() == null) {
                continue;
            }
            ProjectionMatch match = projectedDistanceAlongPolyline(anchor.latitude(), anchor.longitude(), corridorPolyline, cumulative);
            if (match.distanceToCorridorMeters() > maxSnapDistanceMeters) {
                continue;
            }
            projected.add(new AnchorProjection(match.projectedMeters(), anchor.mileMarker()));
        }
        projected.sort(Comparator.comparingDouble(AnchorProjection::projectedMeters));
        return projected;
    }

    private static Double interpolateFromAnchors(double projectedMeters, List<AnchorProjection> anchors) {
        if (anchors == null || anchors.size() < 2) {
            return null;
        }

        for (int i = 0; i < anchors.size() - 1; i++) {
            AnchorProjection left = anchors.get(i);
            AnchorProjection right = anchors.get(i + 1);
            if (projectedMeters <= right.projectedMeters()) {
                return interpolateBetweenAnchors(projectedMeters, left, right);
            }
        }

        return interpolateBetweenAnchors(projectedMeters, anchors.get(anchors.size() - 2), anchors.get(anchors.size() - 1));
    }

    private static Double interpolateBetweenAnchors(double projectedMeters, AnchorProjection left, AnchorProjection right) {
        double span = right.projectedMeters() - left.projectedMeters();
        if (span <= 0.0) {
            return left.mileMarker();
        }
        double t = (projectedMeters - left.projectedMeters()) / span;
        t = Math.max(0.0, Math.min(1.0, t));
        return left.mileMarker() + (t * (right.mileMarker() - left.mileMarker()));
    }

    private static double confidenceFor(String method, double distanceToCorridorMeters, double maxSnapDistanceMeters) {
        double normalizedDistance = Math.max(0.0, Math.min(1.0, distanceToCorridorMeters / Math.max(1.0, maxSnapDistanceMeters)));
        double value = switch (method) {
            case "anchor_interpolated" -> 0.95 - (normalizedDistance * 0.30);
            case "range_interpolated" -> 0.84 - (normalizedDistance * 0.34);
            default -> 0.30;
        };
        return roundToTwoDecimals(Math.max(0.20, Math.min(0.99, value)));
    }

    private static double maxSnapDistanceMeters(TrafficProps.Corridor corridor) {
        if (corridor == null || corridor.maxSnapDistanceMeters() == null || corridor.maxSnapDistanceMeters() <= 0.0) {
            return DEFAULT_MAX_SNAP_DISTANCE_METERS;
        }
        return corridor.maxSnapDistanceMeters();
    }

    private static String inferProjectedDirection(
        List<double[]> points,
        List<double[]> corridorPolyline,
        double[] cumulative,
        CorridorAxis axis,
        String primary,
        String secondary
    ) {
        if (corridorPolyline == null || corridorPolyline.size() < 2 || cumulative == null || cumulative.length != corridorPolyline.size()) {
            return null;
        }

        double startProjected = projectedDistanceAlongPolyline(points.get(0)[0], points.get(0)[1], corridorPolyline, cumulative).projectedMeters();
        double endProjected = projectedDistanceAlongPolyline(points.get(points.size() - 1)[0], points.get(points.size() - 1)[1], corridorPolyline, cumulative).projectedMeters();
        double deltaProjected = endProjected - startProjected;
        if (Math.abs(deltaProjected) < 25.0) {
            return null;
        }

        String forward = forwardCorridorDirection(corridorPolyline, axis);
        if (forward == null) {
            return null;
        }
        String reverse = oppositeDirection(forward);
        String candidate = deltaProjected >= 0.0 ? forward : reverse;
        if (candidate != null && (candidate.equals(primary) || candidate.equals(secondary))) {
            return candidate;
        }
        if (primary != null && secondary != null) {
            return deltaProjected >= 0.0 ? primary : secondary;
        }
        return candidate;
    }

    private static String inferAxisConstrainedDirection(double[] first, double[] last, CorridorAxis axis) {
        double latDelta = last[0] - first[0];
        double lonDelta = last[1] - first[1];

        return switch (axis) {
            case NORTH_SOUTH -> latDelta >= 0 ? "N" : "S";
            case EAST_WEST -> lonDelta >= 0 ? "E" : "W";
            case UNKNOWN -> Math.abs(latDelta) >= Math.abs(lonDelta)
                ? (latDelta >= 0 ? "N" : "S")
                : (lonDelta >= 0 ? "E" : "W");
        };
    }

    private static CorridorAxis corridorAxis(String primary, String secondary, List<double[]> corridorPolyline) {
        if (isNorthSouth(primary) || isNorthSouth(secondary)) {
            if (!isEastWest(primary) && !isEastWest(secondary)) {
                return CorridorAxis.NORTH_SOUTH;
            }
        }
        if (isEastWest(primary) || isEastWest(secondary)) {
            if (!isNorthSouth(primary) && !isNorthSouth(secondary)) {
                return CorridorAxis.EAST_WEST;
            }
        }
        if (corridorPolyline == null || corridorPolyline.size() < 2) {
            return CorridorAxis.UNKNOWN;
        }
        double[] first = corridorPolyline.get(0);
        double[] last = corridorPolyline.get(corridorPolyline.size() - 1);
        return Math.abs(last[0] - first[0]) >= Math.abs(last[1] - first[1])
            ? CorridorAxis.NORTH_SOUTH
            : CorridorAxis.EAST_WEST;
    }

    private static String forwardCorridorDirection(List<double[]> corridorPolyline, CorridorAxis axis) {
        if (corridorPolyline == null || corridorPolyline.size() < 2) {
            return null;
        }
        double[] first = corridorPolyline.get(0);
        double[] last = corridorPolyline.get(corridorPolyline.size() - 1);
        return switch (axis) {
            case NORTH_SOUTH -> last[0] >= first[0] ? "N" : "S";
            case EAST_WEST -> last[1] >= first[1] ? "E" : "W";
            case UNKNOWN -> Math.abs(last[0] - first[0]) >= Math.abs(last[1] - first[1])
                ? (last[0] >= first[0] ? "N" : "S")
                : (last[1] >= first[1] ? "E" : "W");
        };
    }

    private static String oppositeDirection(String direction) {
        return switch (normalizeDirection(direction)) {
            case "N" -> "S";
            case "S" -> "N";
            case "E" -> "W";
            case "W" -> "E";
            default -> null;
        };
    }

    private static boolean isNorthSouth(String direction) {
        String normalized = normalizeDirection(direction);
        return "N".equals(normalized) || "S".equals(normalized);
    }

    private static boolean isEastWest(String direction) {
        String normalized = normalizeDirection(direction);
        return "E".equals(normalized) || "W".equals(normalized);
    }

    private static double roundToSingleDecimal(double value) {
        return Math.round(value * 10.0) / 10.0;
    }

    private static double roundToTwoDecimals(double value) {
        return Math.round(value * 100.0) / 100.0;
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
    private record ProjectionMatch(double projectedMeters, double distanceToCorridorMeters) {}
    private record AnchorProjection(double projectedMeters, double mileMarker) {}
    private enum CorridorAxis { NORTH_SOUTH, EAST_WEST, UNKNOWN }
    private record MileMarkerResolution(
        Double closestMileMarker,
        String method,
        Double confidence,
        Double distanceToCorridorMeters
    ) {}
}
