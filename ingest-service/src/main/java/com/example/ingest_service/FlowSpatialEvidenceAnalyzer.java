package com.example.ingest_service;

import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

final class FlowSpatialEvidenceAnalyzer {
    private static final double EARTH_RADIUS_METERS = 6_371_008.8;
    private static final double METERS_PER_MILE = 1_609.344;
    private static final double MIN_ORIENTATION_SPAN_METERS = METERS_PER_MILE / 10.0;

    private FlowSpatialEvidenceAnalyzer() {}

    static FlowSpatialEvidence analyze(
        String corridor,
        int sourceZoom,
        Instant observedAt,
        List<DecodedTrafficFeature> decodedFeatures,
        List<double[]> route,
        double routeBufferMeters
    ) {
        List<DecodedTrafficFeature> features = decodedFeatures == null ? List.of() : decodedFeatures;
        if (route == null || route.size() < 2) {
            return empty(corridor, sourceZoom, observedAt, features.size(), "ROUTE_UNAVAILABLE",
                "Configured corridor geometry is unavailable; no spatial claims were evaluated.");
        }

        double[] cumulativeRouteMeters = cumulativeDistances(route);
        Set<String> seen = new HashSet<>();
        List<Double> featureLengths = new ArrayList<>();
        List<Double> routeSpans = new ArrayList<>();
        List<Double> maximumRouteDistances = new ArrayList<>();
        int corridorFeatureCount = 0;
        int duplicateFeatureCount = 0;
        int oneSideFeatureCount = 0;
        int fullCoverageFeatureCount = 0;
        int unknownCoverageFeatureCount = 0;
        int closureFeatureCount = 0;
        int routeOrderForwardFeatureCount = 0;
        int routeOrderReverseFeatureCount = 0;
        int ambiguousOrientationFeatureCount = 0;

        for (DecodedTrafficFeature feature : features) {
            if (!isCorridorRoadType(textTag(feature.tags(), "road_type", "road_category"))) continue;
            if (numberTag(feature.tags(), "traffic_level") == null) continue;

            FeatureProjection projection = projectFeature(feature.paths(), route, cumulativeRouteMeters);
            if (projection == null || projection.minimumRouteDistanceMeters() > routeBufferMeters) continue;
            corridorFeatureCount++;

            String key = evidenceKey(feature);
            if (!seen.add(key)) {
                duplicateFeatureCount++;
                continue;
            }

            featureLengths.add(projection.featureLengthMeters() / METERS_PER_MILE);
            routeSpans.add(projection.routeSpanMeters() / METERS_PER_MILE);
            maximumRouteDistances.add(projection.maximumRouteDistanceMeters());

            String coverage = textTag(feature.tags(), "traffic_road_coverage");
            if (coverage == null) unknownCoverageFeatureCount++;
            else if (coverage.equalsIgnoreCase("one_side")) oneSideFeatureCount++;
            else if (coverage.equalsIgnoreCase("full")) fullCoverageFeatureCount++;
            else unknownCoverageFeatureCount++;

            if (booleanTag(feature.tags(), "road_closure")) closureFeatureCount++;

            if (projection.routeSpanMeters() < MIN_ORIENTATION_SPAN_METERS) {
                ambiguousOrientationFeatureCount++;
            } else if (projection.routeOrderDeltaMeters() > 0.0) {
                routeOrderForwardFeatureCount++;
            } else {
                routeOrderReverseFeatureCount++;
            }
        }

        int uniqueFeatureCount = seen.size();
        String status = uniqueFeatureCount == 0 ? "NO_MATCHING_FEATURES" : "OBSERVED";
        String detail = uniqueFeatureCount == 0
            ? "No speed-bearing motorway features matched the configured corridor buffer."
            : "Orientation counts are relative to configured route coordinate order, not validated travel directions.";
        return new FlowSpatialEvidence(
            corridor,
            observedAt,
            sourceZoom,
            status,
            detail,
            features.size(),
            corridorFeatureCount,
            uniqueFeatureCount,
            duplicateFeatureCount,
            oneSideFeatureCount,
            fullCoverageFeatureCount,
            unknownCoverageFeatureCount,
            closureFeatureCount,
            routeOrderForwardFeatureCount,
            routeOrderReverseFeatureCount,
            ambiguousOrientationFeatureCount,
            distribution(featureLengths),
            distribution(routeSpans),
            distribution(maximumRouteDistances)
        );
    }

    private static FlowSpatialEvidence empty(
        String corridor,
        int sourceZoom,
        Instant observedAt,
        int decodedFeatureCount,
        String status,
        String detail
    ) {
        FlowSpatialEvidence.Distribution empty = FlowSpatialEvidence.Distribution.empty();
        return new FlowSpatialEvidence(
            corridor, observedAt, sourceZoom, status, detail, decodedFeatureCount,
            0, 0, 0, 0, 0, 0, 0, 0, 0, 0, empty, empty, empty
        );
    }

    private static FeatureProjection projectFeature(
        List<List<double[]>> paths,
        List<double[]> route,
        double[] cumulativeRouteMeters
    ) {
        if (paths == null || paths.isEmpty()) return null;
        List<double[]> longestPath = null;
        double longestPathMeters = -1.0;
        double totalFeatureMeters = 0.0;
        double minimumRouteDistanceMeters = Double.POSITIVE_INFINITY;
        double maximumRouteDistanceMeters = 0.0;

        for (List<double[]> path : paths) {
            if (path == null || path.isEmpty()) continue;
            double pathMeters = pathLengthMeters(path);
            totalFeatureMeters += pathMeters;
            if (pathMeters > longestPathMeters) {
                longestPathMeters = pathMeters;
                longestPath = path;
            }
            for (double[] point : path) {
                RouteProjection projected = projectToRoute(point, route, cumulativeRouteMeters);
                minimumRouteDistanceMeters = Math.min(minimumRouteDistanceMeters, projected.distanceMeters());
                maximumRouteDistanceMeters = Math.max(maximumRouteDistanceMeters, projected.distanceMeters());
            }
        }
        if (longestPath == null || longestPath.isEmpty()) return null;

        RouteProjection start = projectToRoute(longestPath.get(0), route, cumulativeRouteMeters);
        RouteProjection end = projectToRoute(longestPath.get(longestPath.size() - 1), route, cumulativeRouteMeters);
        double routeOrderDeltaMeters = end.alongRouteMeters() - start.alongRouteMeters();
        return new FeatureProjection(
            totalFeatureMeters,
            Math.abs(routeOrderDeltaMeters),
            routeOrderDeltaMeters,
            minimumRouteDistanceMeters,
            maximumRouteDistanceMeters
        );
    }

    private static RouteProjection projectToRoute(
        double[] point,
        List<double[]> route,
        double[] cumulativeRouteMeters
    ) {
        double bestDistanceMeters = Double.POSITIVE_INFINITY;
        double bestAlongRouteMeters = 0.0;
        for (int i = 0; i < route.size() - 1; i++) {
            double[] start = route.get(i);
            double[] end = route.get(i + 1);
            SegmentProjection projection = projectToSegment(point, start, end);
            if (projection.distanceMeters() < bestDistanceMeters) {
                bestDistanceMeters = projection.distanceMeters();
                bestAlongRouteMeters = cumulativeRouteMeters[i]
                    + (projection.fraction() * (cumulativeRouteMeters[i + 1] - cumulativeRouteMeters[i]));
            }
        }
        return new RouteProjection(bestAlongRouteMeters, bestDistanceMeters);
    }

    private static SegmentProjection projectToSegment(double[] point, double[] start, double[] end) {
        double referenceLatitude = Math.toRadians((point[0] + start[0] + end[0]) / 3.0);
        double startX = Math.toRadians(start[1] - point[1]) * EARTH_RADIUS_METERS * Math.cos(referenceLatitude);
        double startY = Math.toRadians(start[0] - point[0]) * EARTH_RADIUS_METERS;
        double endX = Math.toRadians(end[1] - point[1]) * EARTH_RADIUS_METERS * Math.cos(referenceLatitude);
        double endY = Math.toRadians(end[0] - point[0]) * EARTH_RADIUS_METERS;
        double deltaX = endX - startX;
        double deltaY = endY - startY;
        double lengthSquared = (deltaX * deltaX) + (deltaY * deltaY);
        double fraction = lengthSquared == 0.0
            ? 0.0
            : Math.max(0.0, Math.min(1.0, -((startX * deltaX) + (startY * deltaY)) / lengthSquared));
        double closestX = startX + (fraction * deltaX);
        double closestY = startY + (fraction * deltaY);
        return new SegmentProjection(fraction, Math.hypot(closestX, closestY));
    }

    private static double[] cumulativeDistances(List<double[]> route) {
        double[] cumulative = new double[route.size()];
        for (int i = 1; i < route.size(); i++) {
            cumulative[i] = cumulative[i - 1] + haversineMeters(route.get(i - 1), route.get(i));
        }
        return cumulative;
    }

    private static double pathLengthMeters(List<double[]> path) {
        double total = 0.0;
        for (int i = 1; i < path.size(); i++) total += haversineMeters(path.get(i - 1), path.get(i));
        return total;
    }

    private static double haversineMeters(double[] start, double[] end) {
        double latitudeDelta = Math.toRadians(end[0] - start[0]);
        double longitudeDelta = Math.toRadians(end[1] - start[1]);
        double value = Math.sin(latitudeDelta / 2.0) * Math.sin(latitudeDelta / 2.0)
            + Math.cos(Math.toRadians(start[0])) * Math.cos(Math.toRadians(end[0]))
            * Math.sin(longitudeDelta / 2.0) * Math.sin(longitudeDelta / 2.0);
        return 2.0 * EARTH_RADIUS_METERS * Math.asin(Math.sqrt(value));
    }

    private static String evidenceKey(DecodedTrafficFeature feature) {
        List<double[]> path = longestPath(feature.paths());
        if (path.isEmpty()) return "empty|" + feature.tags();
        String first = coordinateKey(path.get(0));
        String last = coordinateKey(path.get(path.size() - 1));
        String endpoints = first.compareTo(last) <= 0 ? first + "|" + last : last + "|" + first;
        return endpoints
            + "|" + numberTag(feature.tags(), "traffic_level")
            + "|" + textTag(feature.tags(), "traffic_road_coverage")
            + "|" + booleanTag(feature.tags(), "road_closure");
    }

    private static List<double[]> longestPath(List<List<double[]>> paths) {
        if (paths == null) return List.of();
        return paths.stream()
            .filter(path -> path != null && !path.isEmpty())
            .max(Comparator.comparingDouble(FlowSpatialEvidenceAnalyzer::pathLengthMeters))
            .orElse(List.of());
    }

    private static String coordinateKey(double[] coordinate) {
        return String.format(Locale.US, "%.5f,%.5f", coordinate[0], coordinate[1]);
    }

    private static String textTag(Map<String, Object> tags, String... names) {
        if (tags == null) return null;
        for (String name : names) {
            Object value = tags.get(name);
            if (value != null && !String.valueOf(value).isBlank()) return String.valueOf(value).trim();
        }
        return null;
    }

    private static Double numberTag(Map<String, Object> tags, String name) {
        if (tags == null) return null;
        Object value = tags.get(name);
        if (value instanceof Number number) return number.doubleValue();
        if (value == null) return null;
        try {
            return Double.parseDouble(String.valueOf(value));
        } catch (NumberFormatException ignored) {
            return null;
        }
    }

    private static boolean booleanTag(Map<String, Object> tags, String name) {
        if (tags == null) return false;
        Object value = tags.get(name);
        if (value instanceof Boolean bool) return bool;
        return value != null && Boolean.parseBoolean(String.valueOf(value));
    }

    private static boolean isCorridorRoadType(String roadType) {
        if (roadType == null || roadType.isBlank()) return false;
        String normalized = roadType.trim().toLowerCase(Locale.ROOT);
        return normalized.contains("motorway")
            || normalized.contains("international")
            || normalized.contains("major road")
            || normalized.equals("0")
            || normalized.equals("1")
            || normalized.equals("2");
    }

    private static FlowSpatialEvidence.Distribution distribution(List<Double> values) {
        if (values.isEmpty()) return FlowSpatialEvidence.Distribution.empty();
        List<Double> sorted = values.stream().sorted().toList();
        return new FlowSpatialEvidence.Distribution(
            rounded(sorted.get(0)),
            rounded(percentile(sorted, 0.50)),
            rounded(percentile(sorted, 0.90)),
            rounded(sorted.get(sorted.size() - 1))
        );
    }

    private static double percentile(List<Double> sorted, double quantile) {
        if (sorted.size() == 1) return sorted.get(0);
        double index = quantile * (sorted.size() - 1);
        int lower = (int) Math.floor(index);
        int upper = (int) Math.ceil(index);
        if (lower == upper) return sorted.get(lower);
        double weight = index - lower;
        return sorted.get(lower) + ((sorted.get(upper) - sorted.get(lower)) * weight);
    }

    private static double rounded(double value) {
        return Math.round(value * 1_000.0) / 1_000.0;
    }

    private record RouteProjection(double alongRouteMeters, double distanceMeters) {}
    private record SegmentProjection(double fraction, double distanceMeters) {}
    private record FeatureProjection(
        double featureLengthMeters,
        double routeSpanMeters,
        double routeOrderDeltaMeters,
        double minimumRouteDistanceMeters,
        double maximumRouteDistanceMeters
    ) {}
}
