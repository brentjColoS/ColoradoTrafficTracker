package com.example.ingest_service;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

final class CorridorFlowPathExtractor {
    private CorridorFlowPathExtractor() {}

    static Result extract(
        List<DecodedTrafficFeature> decodedFeatures,
        CorridorPathProjector pathProjector,
        double routeBufferMeters
    ) {
        List<DecodedTrafficFeature> features = decodedFeatures == null ? List.of() : decodedFeatures;
        Set<String> seen = new HashSet<>();
        List<PathObservation> observations = new ArrayList<>();
        int corridorPathCount = 0;
        int duplicatePathCount = 0;

        for (DecodedTrafficFeature feature : features) {
            if (!isCorridorRoadType(textTag(feature.tags(), "road_type", "road_category"))) continue;

            Double speedKph = numberTag(feature.tags(), "traffic_level");
            if (speedKph == null) continue;

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

                observations.add(new PathObservation(
                    projection,
                    speedKph,
                    textTag(feature.tags(), "traffic_road_coverage"),
                    booleanTag(feature.tags(), "road_closure")
                ));
            }
        }

        return new Result(
            features.size(),
            decodedPathCount(features),
            corridorPathCount,
            duplicatePathCount,
            List.copyOf(observations)
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

    record Result(
        int decodedFeatureCount,
        int decodedPathCount,
        int corridorPathCount,
        int duplicatePathCount,
        List<PathObservation> observations
    ) {}

    record PathObservation(
        CorridorPathProjector.PathProjection projection,
        double speedKph,
        String roadCoverage,
        boolean roadClosure
    ) {}
}
