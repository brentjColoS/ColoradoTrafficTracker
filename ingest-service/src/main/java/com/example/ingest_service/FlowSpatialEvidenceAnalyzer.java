package com.example.ingest_service;

import java.time.Instant;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

final class FlowSpatialEvidenceAnalyzer {
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
        int decodedPathCount = decodedPathCount(features);
        if (route == null || route.size() < 2) {
            return empty(corridor, sourceZoom, observedAt, features.size(), decodedPathCount, "ROUTE_UNAVAILABLE",
                "Configured corridor geometry is unavailable; no spatial claims were evaluated.");
        }

        CorridorPathProjector pathProjector = new CorridorPathProjector(route);
        Set<String> seen = new HashSet<>();
        List<Double> pathLengths = new ArrayList<>();
        List<Double> routeSpans = new ArrayList<>();
        List<Double> maximumRouteDistances = new ArrayList<>();
        int corridorPathCount = 0;
        int duplicatePathCount = 0;
        int oneSidePathCount = 0;
        int fullCoveragePathCount = 0;
        int unknownCoveragePathCount = 0;
        int closurePathCount = 0;
        int routeOrderForwardPathCount = 0;
        int routeOrderReversePathCount = 0;
        int ambiguousOrientationPathCount = 0;

        for (DecodedTrafficFeature feature : features) {
            if (!isCorridorRoadType(textTag(feature.tags(), "road_type", "road_category"))) continue;
            if (numberTag(feature.tags(), "traffic_level") == null) continue;

            for (List<double[]> path : pathsOf(feature)) {
                CorridorPathProjector.PathProjection projection =
                    pathProjector.longestContiguousPortion(path, routeBufferMeters);
                if (projection == null) continue;
                corridorPathCount++;

                String key = evidenceKey(path, feature.tags());
                if (!seen.add(key)) {
                    duplicatePathCount++;
                    continue;
                }

                pathLengths.add(projection.pathLengthMeters() / METERS_PER_MILE);
                routeSpans.add(projection.routeSpanMeters() / METERS_PER_MILE);
                maximumRouteDistances.add(projection.maximumRouteDistanceMeters());

                String coverage = textTag(feature.tags(), "traffic_road_coverage");
                if (coverage == null) unknownCoveragePathCount++;
                else if (coverage.equalsIgnoreCase("one_side")) oneSidePathCount++;
                else if (coverage.equalsIgnoreCase("full")) fullCoveragePathCount++;
                else unknownCoveragePathCount++;

                if (booleanTag(feature.tags(), "road_closure")) closurePathCount++;

                if (projection.routeSpanMeters() < MIN_ORIENTATION_SPAN_METERS) {
                    ambiguousOrientationPathCount++;
                } else if (projection.routeOrderDeltaMeters() > 0.0) {
                    routeOrderForwardPathCount++;
                } else {
                    routeOrderReversePathCount++;
                }
            }
        }

        int uniquePathCount = seen.size();
        String status = uniquePathCount == 0 ? "NO_MATCHING_PATHS" : "OBSERVED";
        String detail = uniquePathCount == 0
            ? "No speed-bearing motorway paths matched the configured corridor buffer."
            : "Length and route-span distributions cover each path's longest contiguous portion inside the corridor buffer; "
                + "orientation counts are relative to configured route coordinate order, not validated travel directions.";
        return new FlowSpatialEvidence(
            corridor,
            observedAt,
            sourceZoom,
            status,
            detail,
            features.size(),
            decodedPathCount,
            corridorPathCount,
            uniquePathCount,
            duplicatePathCount,
            oneSidePathCount,
            fullCoveragePathCount,
            unknownCoveragePathCount,
            closurePathCount,
            routeOrderForwardPathCount,
            routeOrderReversePathCount,
            ambiguousOrientationPathCount,
            distribution(pathLengths),
            distribution(routeSpans),
            distribution(maximumRouteDistances)
        );
    }

    private static FlowSpatialEvidence empty(
        String corridor,
        int sourceZoom,
        Instant observedAt,
        int decodedFeatureCount,
        int decodedPathCount,
        String status,
        String detail
    ) {
        FlowSpatialEvidence.Distribution empty = FlowSpatialEvidence.Distribution.empty();
        return new FlowSpatialEvidence(
            corridor, observedAt, sourceZoom, status, detail, decodedFeatureCount, decodedPathCount,
            0, 0, 0, 0, 0, 0, 0, 0, 0, 0, empty, empty, empty
        );
    }

    private static String evidenceKey(List<double[]> path, Map<String, Object> tags) {
        String first = coordinateKey(path.get(0));
        String last = coordinateKey(path.get(path.size() - 1));
        String endpoints = first.compareTo(last) <= 0 ? first + "|" + last : last + "|" + first;
        return endpoints
            + "|" + numberTag(tags, "traffic_level")
            + "|" + textTag(tags, "traffic_road_coverage")
            + "|" + booleanTag(tags, "road_closure");
    }

    private static int decodedPathCount(List<DecodedTrafficFeature> features) {
        int count = 0;
        for (DecodedTrafficFeature feature : features) {
            for (List<double[]> path : pathsOf(feature)) {
                if (path != null && path.size() >= 2) count++;
            }
        }
        return count;
    }

    private static List<List<double[]>> pathsOf(DecodedTrafficFeature feature) {
        return feature.paths() == null ? List.of() : feature.paths();
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

}
