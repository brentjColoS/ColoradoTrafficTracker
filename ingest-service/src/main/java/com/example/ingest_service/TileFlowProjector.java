package com.example.ingest_service;

import static com.example.ingest_service.CorridorGeometrySupport.*;
import static com.example.ingest_service.TrafficTileFeatures.*;
import com.example.common.CorridorSpeedZones;
import com.example.common.SpeedZoneDefinition;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

final class TileFlowProjector {
    private TileFlowProjector() {}

    private static final double KPH_TO_MPH = 0.621371;
    private static final double METERS_PER_MILE = 1609.344;
    private static final double DEFAULT_SPEED_SAMPLE_SPACING_METERS = METERS_PER_MILE / 2.0;
    private static final double DEFAULT_SPEED_BLEND_RADIUS_METERS = 90.0;
    private static final int DEFAULT_SPEED_BLEND_MAX_CANDIDATES = 3;
    private static final String CORRIDOR_I25 = "I25";

    record FlowCandidate(double speedMph, List<List<double[]>> paths) {}
    private record RouteSamplePoint(double lat, double lon, Double mileMarker) {}
    record CorridorSpeedObservation(Double mileMarker, Double speedMph) {}
    record CorridorSpeedProjection(List<FlowCandidate> candidates, List<CorridorSpeedObservation> observations) {
        List<Double> speeds() {
            return observations.stream()
                .map(CorridorSpeedObservation::speedMph)
                .filter(speed -> speed != null)
                .toList();
        }
    }
    record ZoneSlowdownSignal(boolean localized, String note) {
        private static ZoneSlowdownSignal none() {
            return new ZoneSlowdownSignal(false, null);
        }
    }
    record ZoneSampleBundle(List<TrafficSpeedZoneSample> zoneSamples, ZoneSlowdownSignal slowdownSignal) {
        private static ZoneSampleBundle empty() {
            return new ZoneSampleBundle(List.of(), ZoneSlowdownSignal.none());
        }
    }

    private record CandidateDistance(FlowCandidate candidate, double distanceMeters) {}

    static CorridorSpeedProjection collectCorridorSpeeds(
        TrafficProps.Corridor corridor,
        Set<TrafficTile> corridorTiles,
        Map<TrafficTile, List<DecodedTrafficFeature>> flowTiles,
        List<double[]> route,
        double routeBufferMeters
    ) {
        List<FlowCandidate> candidates = buildFlowCandidates(corridorTiles, flowTiles, route, routeBufferMeters);
        if (candidates.isEmpty()) return new CorridorSpeedProjection(List.of(), List.of());

        List<RouteSamplePoint> routeSamples = sampleRoutePoints(
            route,
            DEFAULT_SPEED_SAMPLE_SPACING_METERS,
            corridor.startMileMarker(),
            corridor.endMileMarker()
        );
        if (routeSamples.isEmpty()) {
            // Fallback: route unavailable; preserve one speed per unique flow feature.
            List<CorridorSpeedObservation> fallback = new ArrayList<>(candidates.size());
            for (FlowCandidate candidate : candidates) {
                fallback.add(new CorridorSpeedObservation(null, candidate.speedMph()));
            }
            return new CorridorSpeedProjection(List.copyOf(candidates), fallback);
        }

        List<CorridorSpeedObservation> observations = new ArrayList<>(routeSamples.size());
        for (RouteSamplePoint sample : routeSamples) {
            Double speed = projectedSpeedForSample(corridor.name(), sample.lat(), sample.lon(), candidates, routeBufferMeters);
            observations.add(new CorridorSpeedObservation(sample.mileMarker(), speed));
        }
        return new CorridorSpeedProjection(List.copyOf(candidates), observations);
    }

    private static List<FlowCandidate> buildFlowCandidates(
        Set<TrafficTile> corridorTiles,
        Map<TrafficTile, List<DecodedTrafficFeature>> flowTiles,
        List<double[]> route,
        double routeBufferMeters
    ) {
        List<FlowCandidate> candidates = new ArrayList<>();
        Set<String> seen = new HashSet<>();

        for (TrafficTile key : corridorTiles) {
            for (DecodedTrafficFeature feature : flowTiles.getOrDefault(key, List.of())) {
                String roadType = getStringTag(feature.tags(), "road_type", "road_category");
                if (!isCorridorRoadType(roadType)) continue;
                if (!featureWithinBuffer(feature, route, routeBufferMeters)) continue;

                Double speedKph = getDoubleTag(feature.tags(), "traffic_level");
                if (speedKph == null) continue;

                String dedupeKey = flowFeatureKey(feature, speedKph);
                if (!seen.add(dedupeKey)) continue;

                candidates.add(new FlowCandidate(speedKph * KPH_TO_MPH, feature.paths()));
            }
        }

        return candidates;
    }

    static Double projectedSpeedForSample(
        String corridorName,
        double lat,
        double lon,
        List<FlowCandidate> candidates,
        double maxDistanceMeters
    ) {
        List<CandidateDistance> nearest = nearestCandidatesForSample(lat, lon, candidates, maxDistanceMeters);
        if (nearest.isEmpty()) return null;
        if (!usesBlendedProjection(corridorName)) return nearest.get(0).candidate().speedMph();

        List<CandidateDistance> blendable = new ArrayList<>(DEFAULT_SPEED_BLEND_MAX_CANDIDATES);
        for (CandidateDistance candidateDistance : nearest) {
            if (candidateDistance.distanceMeters() > DEFAULT_SPEED_BLEND_RADIUS_METERS) break;
            blendable.add(candidateDistance);
            if (blendable.size() >= DEFAULT_SPEED_BLEND_MAX_CANDIDATES) break;
        }
        if (blendable.size() < 2) return nearest.get(0).candidate().speedMph();
        return inverseDistanceWeightedSpeed(blendable);
    }

    private static List<CandidateDistance> nearestCandidatesForSample(
        double lat,
        double lon,
        List<FlowCandidate> candidates,
        double maxDistanceMeters
    ) {
        List<CandidateDistance> matches = new ArrayList<>();
        for (FlowCandidate candidate : candidates) {
            double distance = minDistanceMetersToFeature(lat, lon, candidate.paths());
            if (distance <= maxDistanceMeters) {
                matches.add(new CandidateDistance(candidate, distance));
            }
        }
        matches.sort((left, right) -> Double.compare(left.distanceMeters(), right.distanceMeters()));
        return matches;
    }

    private static Double inverseDistanceWeightedSpeed(List<CandidateDistance> candidates) {
        double weightedSpeed = 0.0;
        double totalWeight = 0.0;
        for (CandidateDistance candidateDistance : candidates) {
            double weight = 1.0 / Math.max(1.0, candidateDistance.distanceMeters());
            weightedSpeed += candidateDistance.candidate().speedMph() * weight;
            totalWeight += weight;
        }
        if (totalWeight <= 0.0) return null;
        return weightedSpeed / totalWeight;
    }

    private static boolean usesBlendedProjection(String corridorName) {
        return corridorName != null && CORRIDOR_I25.equalsIgnoreCase(corridorName.trim());
    }

    static String collectionProfile(String corridor, Set<TrafficTile> tiles, Set<TrafficTile> fineTiles, boolean hasGeometry) {
        String sources = tiles.stream().map(tile -> tile.z() + "/" + tile.x() + "/" + tile.y()
            + "=" + (fineTiles.contains(tile) ? "1kph" : "default")).sorted()
            .collect(java.util.stream.Collectors.joining(","));
        String matcher = !hasGeometry ? "feature-fallback" : usesBlendedProjection(corridor) ? "blend3" : "nearest";
        return "v1;matcher=" + matcher + ";tiles=" + sources;
    }

    private static List<RouteSamplePoint> sampleRoutePoints(
        List<double[]> polyline,
        double spacingMeters,
        Double startMileMarker,
        Double endMileMarker
    ) {
        if (polyline == null || polyline.size() < 2) return List.of();

        double[] cumulative = cumulativeDistances(polyline);
        double totalMeters = cumulative[cumulative.length - 1];
        if (totalMeters <= 0) return List.of();

        int sampleCount = Math.max(1, (int) Math.floor(totalMeters / Math.max(1.0, spacingMeters)));
        List<RouteSamplePoint> out = new ArrayList<>(sampleCount);
        double step = totalMeters / sampleCount;
        for (int i = 0; i < sampleCount; i++) {
            double target = (i + 0.5) * step;
            double[] point = pointAtDistance(polyline, cumulative, target);
            Double mileMarker = interpolateMileMarker(startMileMarker, endMileMarker, totalMeters <= 0.0 ? 0.0 : target / totalMeters);
            out.add(new RouteSamplePoint(point[0], point[1], mileMarker));
        }
        return out;
    }

    private static double[] cumulativeDistances(List<double[]> polyline) {
        double[] cumulative = new double[polyline.size()];
        cumulative[0] = 0.0;
        for (int i = 1; i < polyline.size(); i++) {
            double[] prev = polyline.get(i - 1);
            double[] curr = polyline.get(i);
            cumulative[i] = cumulative[i - 1] + haversineMeters(prev[0], prev[1], curr[0], curr[1]);
        }
        return cumulative;
    }

    private static double[] pointAtDistance(List<double[]> polyline, double[] cumulative, double targetMeters) {
        if (polyline.isEmpty()) return new double[]{0.0, 0.0};
        if (targetMeters <= 0) return polyline.get(0);
        double total = cumulative[cumulative.length - 1];
        if (targetMeters >= total) return polyline.get(polyline.size() - 1);

        int idx = 0;
        while (idx < cumulative.length - 1 && cumulative[idx + 1] < targetMeters) idx++;

        double segmentStart = cumulative[idx];
        double segmentEnd = cumulative[idx + 1];
        double segmentLength = segmentEnd - segmentStart;
        double t = segmentLength <= 0 ? 0.0 : (targetMeters - segmentStart) / segmentLength;

        return interpolate(polyline.get(idx), polyline.get(idx + 1), t);
    }

    private static Double interpolateMileMarker(Double startMileMarker, Double endMileMarker, double fraction) {
        if (startMileMarker == null || endMileMarker == null) return null;
        double clamped = Math.max(0.0, Math.min(1.0, fraction));
        return startMileMarker + ((endMileMarker - startMileMarker) * clamped);
    }

    private static String flowFeatureKey(DecodedTrafficFeature feature, Double speedKph) {
        List<double[]> path = firstPath(feature.paths());
        if (path.isEmpty()) return "";
        double[] start = path.get(0);
        double[] end = path.get(path.size() - 1);
        String roadType = getStringTag(feature.tags(), "road_type", "road_category");
        return String.format(
            Locale.US,
            "%s|%.5f,%.5f|%.5f,%.5f|%.2f",
            roadType == null ? "" : roadType,
            start[0], start[1],
            end[0], end[1],
            speedKph
        );
    }

    private static double minDistanceMetersToFeature(double lat, double lon, List<List<double[]>> paths) {
        double min = Double.POSITIVE_INFINITY;
        for (List<double[]> path : paths) {
            if (path == null || path.isEmpty()) continue;
            if (path.size() == 1) {
                double[] point = path.get(0);
                min = Math.min(min, haversineMeters(lat, lon, point[0], point[1]));
                continue;
            }
            min = Math.min(min, minDistanceMetersToPolyline(lat, lon, path));
        }
        return min;
    }

    static ZoneSampleBundle buildZoneSamples(
        String corridorName,
        List<CorridorSpeedObservation> observations,
        TrafficStats corridorStats
    ) {
        List<SpeedZoneDefinition> zones = CorridorSpeedZones.forCorridor(corridorName);
        if (zones.isEmpty() || observations == null || observations.isEmpty()) return ZoneSampleBundle.empty();

        Map<String, List<Double>> speedsByZone = new LinkedHashMap<>();
        for (SpeedZoneDefinition zone : zones) {
            speedsByZone.put(zone.zoneKey(), new ArrayList<>());
        }

        for (CorridorSpeedObservation observation : observations) {
            if (observation.speedMph() == null) continue;
            SpeedZoneDefinition zone = CorridorSpeedZones.locate(corridorName, observation.mileMarker());
            if (zone == null) continue;
            speedsByZone.get(zone.zoneKey()).add(observation.speedMph());
        }

        List<TrafficSpeedZoneSample> zoneSamples = new ArrayList<>(zones.size());
        TrafficSpeedZoneSample slowestZoneSample = null;
        double worstCorridorGap = Double.NEGATIVE_INFINITY;

        for (SpeedZoneDefinition zone : zones) {
            List<Double> zoneSpeeds = speedsByZone.getOrDefault(zone.zoneKey(), List.of());
            TrafficStats zoneStats = TrafficStats.fromSpeeds(zoneSpeeds);

            TrafficSpeedZoneSample zoneSample = new TrafficSpeedZoneSample();
            zoneSample.setZoneKey(zone.zoneKey());
            zoneSample.setZoneOrder(zone.zoneOrder());
            zoneSample.setZoneLabel(zone.label());
            zoneSample.setZoneDescription(zone.description());
            zoneSample.setStartMileMarker(zone.startMileMarker());
            zoneSample.setEndMileMarker(zone.endMileMarker());
            zoneSample.setPostedSpeedMph(zone.postedSpeedMph());
            zoneSample.setAvgCurrentSpeed(zoneStats.avgSpeed());
            zoneSample.setMinCurrentSpeed(zoneStats.minSpeed());
            zoneSample.setSpeedStddev(zoneStats.stddev());
            zoneSample.setP10Speed(zoneStats.p10Speed());
            zoneSample.setP50Speed(zoneStats.p50Speed());
            zoneSample.setP90Speed(zoneStats.p90Speed());
            zoneSample.setSpeedSampleCount(zoneStats.sampleCount());
            zoneSample.setSpeedStateSignature(TrafficSampleSignature.fromZone(
                corridorName,
                zone.zoneKey(),
                zoneStats.avgSpeed(),
                zoneStats.minSpeed(),
                zoneStats.sampleCount(),
                zoneStats.stddev(),
                zoneStats.p10Speed(),
                zoneStats.p50Speed(),
                zoneStats.p90Speed()
            ));
            zoneSamples.add(zoneSample);

            if (zoneStats.avgSpeed() == null || corridorStats.avgSpeed() == null) continue;
            double corridorGap = corridorStats.avgSpeed() - zoneStats.avgSpeed();
            if (corridorGap > worstCorridorGap) {
                worstCorridorGap = corridorGap;
                slowestZoneSample = zoneSample;
            }
        }

        return new ZoneSampleBundle(zoneSamples, localizedSlowdownSignal(corridorStats, slowestZoneSample));
    }

    private static ZoneSlowdownSignal localizedSlowdownSignal(TrafficStats corridorStats, TrafficSpeedZoneSample slowestZoneSample) {
        if (corridorStats == null || corridorStats.avgSpeed() == null || slowestZoneSample == null || slowestZoneSample.getAvgCurrentSpeed() == null) {
            return ZoneSlowdownSignal.none();
        }
        if (slowestZoneSample.getSpeedSampleCount() == null || slowestZoneSample.getSpeedSampleCount() < 4) {
            return ZoneSlowdownSignal.none();
        }

        double corridorGap = corridorStats.avgSpeed() - slowestZoneSample.getAvgCurrentSpeed();
        double postedGap = slowestZoneSample.getPostedSpeedMph() == null
            ? 0.0
            : slowestZoneSample.getPostedSpeedMph() - slowestZoneSample.getAvgCurrentSpeed();
        double p10Gap = corridorStats.p10Speed() == null || corridorStats.avgSpeed() == null
            ? 0.0
            : corridorStats.avgSpeed() - corridorStats.p10Speed();

        if (corridorGap < 6.0 || postedGap < 4.0 || p10Gap < 4.0) {
            return ZoneSlowdownSignal.none();
        }

        String note = String.format(
            Locale.US,
            "Localized slowdown in %s averaging %.1f mph versus %.1f mph corridor average.",
            slowestZoneSample.getZoneLabel(),
            slowestZoneSample.getAvgCurrentSpeed(),
            corridorStats.avgSpeed()
        );
        return new ZoneSlowdownSignal(true, note);
    }

    static String semanticFlowSignature(String corridorName, List<FlowCandidate> candidates) {
        if (candidates == null || candidates.isEmpty()) {
            return TrafficSampleSignature.sha256((corridorName == null ? "" : corridorName.trim()) + "|none");
        }
        List<String> components = new ArrayList<>(candidates.size());
        for (FlowCandidate candidate : candidates) {
            List<double[]> path = firstPath(candidate.paths());
            if (path.isEmpty()) continue;
            double[] start = path.get(0);
            double[] end = path.get(path.size() - 1);
            components.add(String.format(
                Locale.US,
                "%.3f|%.5f,%.5f|%.5f,%.5f",
                candidate.speedMph(),
                start[0],
                start[1],
                end[0],
                end[1]
            ));
        }
        components.sort(String::compareTo);
        return TrafficSampleSignature.sha256(String.join("|", normalizeCorridorName(corridorName), String.join(";", components)));
    }

    private static String normalizeCorridorName(String corridor) {
        return corridor == null ? "" : corridor.trim().toUpperCase(Locale.ROOT);
    }
}
