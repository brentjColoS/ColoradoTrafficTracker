package com.example.ingest_service;

import static org.assertj.core.api.Assertions.*;

import java.util.List;
import java.util.Map;
import java.util.Set;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;

class TileFlowProjectorTest {
    @Test
    void interstatesKeepTheirDifferentMatchingPoliciesAndMissingCoverage() {
        var stopped = candidate(0, -105.00001);
        var moving = candidate(60, -104.9999);
        var candidates = List.of(stopped, moving);

        assertThat(TileFlowProjector.projectedSpeedForSample("I70", 39.71, -105, candidates, 150)).isZero();
        assertThat(TileFlowProjector.projectedSpeedForSample(" i25 ", 39.71, -105, candidates, 150))
            .isBetween(0.0, 60.0);
        assertThat(TileFlowProjector.projectedSpeedForSample("I25", 0, 0, candidates, 150)).isNull();
    }

    @Test
    void fallbackKeepsUniqueZeroSpeedFeaturesAndRejectsOtherRoadsAndMissingSpeeds() {
        var tile = new TrafficTile(10, 1, 1);
        var stopped = feature(Map.of("road_type", "motorway", "traffic_level", "0"));
        var otherRoad = feature(Map.of("road_type", "residential", "traffic_level", 80));
        var unknownSpeed = feature(Map.of("road_type", "motorway"));
        var result = TileFlowProjector.collectCorridorSpeeds(corridor(), Set.of(tile),
            Map.of(tile, List.of(stopped, stopped, otherRoad, unknownSpeed)), List.of(), 150);

        assertThat(result.speeds()).containsExactly(0.0);
        assertThat(result.observations()).singleElement().satisfies(observation ->
            assertThat(observation.mileMarker()).isNull());
        assertThat(TileFlowProjector.buildZoneSamples("I70", result.observations(),
            TrafficStats.fromSpeeds(result.speeds())).zoneSamples()).allSatisfy(zone ->
                assertThat(zone.getSpeedSampleCount()).isZero());
    }

    @Test
    void semanticSignatureIgnoresFeatureOrderWhileProfilesRetainPrecisionAndMatcher() {
        var stopped = candidate(0, -105.00001);
        var moving = candidate(60, -104.9999);
        assertThat(TileFlowProjector.semanticFlowSignature("I70", List.of(stopped, moving)))
            .isEqualTo(TileFlowProjector.semanticFlowSignature(" i70 ", List.of(moving, stopped)));
        var tile = new TrafficTile(10, 213, 388);
        assertThat(TileFlowProjector.collectionProfile("I25", Set.of(tile), Set.of(), true))
            .isEqualTo("v1;matcher=blend3;tiles=10/213/388=default");
        assertThat(TileFlowProjector.collectionProfile("I70", Set.of(tile), Set.of(tile), false))
            .isEqualTo("v1;matcher=feature-fallback;tiles=10/213/388=1kph");
    }

    @Test
    void i25UsesInverseDistanceWeightsForOnlyTheThreeClosestFeatures() {
        var candidates = List.of(pointCandidate(100, 40), pointCandidate(60, 30),
            pointCandidate(30, 20), pointCandidate(0, 10));
        // Weights 1/10, 1/20 and 1/30 give (0 + 1.5 + 2) / (11/60).
        assertThat(TileFlowProjector.projectedSpeedForSample("I25", 0, 0, candidates, 150))
            .isCloseTo(210.0 / 11.0, within(0.000001));
        assertThat(TileFlowProjector.projectedSpeedForSample("I70", 0, 0, candidates, 150)).isZero();
    }

    @Test
    void blendingHonorsNinetyMeterRadiusAndClampsSubMeterWeights() {
        assertThat(TileFlowProjector.projectedSpeedForSample("I25", 0, 0,
            List.of(pointCandidate(0, 30), pointCandidate(60, 89.999)), 150))
            .isCloseTo(60 * 30 / 119.999, within(0.000001));
        assertThat(TileFlowProjector.projectedSpeedForSample("I25", 0, 0,
            List.of(pointCandidate(0, 30), pointCandidate(60, 90.001)), 150)).isZero();
        assertThat(TileFlowProjector.projectedSpeedForSample("I25", 0, 0,
            List.of(pointCandidate(0, 0), pointCandidate(60, 0.5)), 150)).isEqualTo(30.0);
        assertThat(TileFlowProjector.projectedSpeedForSample("I70", 0, 0,
            List.of(pointCandidate(60, 150.001)), 150)).isNull();
        assertThat(TileFlowProjector.projectedSpeedForSample("I70", 0, 0,
            List.of(pointCandidate(60, 149.999)), 150)).isEqualTo(60.0);
    }

    @Test
    void zoneBoundaryBelongsToFirstMatchingZoneAndUnlocatedSpeedsStayOut() {
        var observations = java.util.Arrays.asList(
            new TileFlowProjector.CorridorSpeedObservation(213.1, 0.0),
            new TileFlowProjector.CorridorSpeedObservation(213.10001, 40.0),
            new TileFlowProjector.CorridorSpeedObservation(205.9, 99.0),
            new TileFlowProjector.CorridorSpeedObservation(null, 99.0),
            new TileFlowProjector.CorridorSpeedObservation(210.0, null));
        var zones = TileFlowProjector.buildZoneSamples("I70", observations,
            TrafficStats.fromSpeeds(List.of(0.0, 40.0))).zoneSamples();
        assertThat(zones).hasSize(8);
        assertThat(zones.get(0).getSpeedSampleCount()).isEqualTo(1);
        assertThat(zones.get(0).getAvgCurrentSpeed()).isZero();
        assertThat(zones.get(1).getSpeedSampleCount()).isEqualTo(1);
        assertThat(zones.get(1).getAvgCurrentSpeed()).isEqualTo(40.0);
        assertThat(zones.subList(2, 8)).allSatisfy(zone -> {
            assertThat(zone.getSpeedSampleCount()).isZero();
            assertThat(zone.getAvgCurrentSpeed()).isNull();
        });
        assertThat(TileFlowProjector.buildZoneSamples("unknown", observations,
            TrafficStats.fromSpeeds(List.of(40.0))).zoneSamples()).isEmpty();
    }

    @ParameterizedTest
    @CsvSource({
        "4, 56, 62, 58, true", // All three gaps at their minimum.
        "3, 56, 62, 58, false",
        "4, 56, 61.999, 57.999, false",
        "4, 56.001, 62.001, 58.001, false",
        "4, 56, 62, 58.001, false"
    })
    void slowdownRequiresEnoughSamplesAndEveryGap(int count, double speed,
        double corridorAverage, double corridorP10, boolean expected) {
        var observations = java.util.stream.IntStream.range(0, count)
            .mapToObj(i -> new TileFlowProjector.CorridorSpeedObservation(210.0, speed)).toList();
        var stats = new TrafficStats(20, corridorAverage, corridorP10, 1.0, corridorP10, corridorAverage, corridorAverage);
        var signal = TileFlowProjector.buildZoneSamples("I70", observations, stats).slowdownSignal();
        assertThat(signal.localized()).isEqualTo(expected);
        if (expected) {
            assertThat(signal.note()).isEqualTo(
                "Localized slowdown in MM 206-213.1 | 60 mph averaging 56.0 mph versus 62.0 mph corridor average.");
        } else {
            assertThat(signal.note()).isNull();
        }
    }

    @Test
    void routeSamplingKeepsMissingCoverageAndDescendingMileMarkers() {
        var tile = new TrafficTile(10, 1, 1);
        var route = List.of(new double[]{0, 0}, new double[]{0.02, 0});
        var feature = new DecodedTrafficFeature("Traffic flow",
            List.of(List.of(new double[]{0.005, 0})), Map.of("road_type", "motorway", "traffic_level", 100));
        var corridor = new TrafficProps.Corridor("I70", "I70", "I-70", "E", "W", 212.0, 208.0,
            List.of(), "0,0,0.02,0", null, null, 150.0);
        var projection = TileFlowProjector.collectCorridorSpeeds(corridor, Set.of(tile),
            Map.of(tile, List.of(feature)), route, 150);
        assertThat(projection.observations()).hasSize(2);
        assertThat(projection.observations().get(0).mileMarker()).isEqualTo(211.0);
        assertThat(projection.observations().get(0).speedMph()).isCloseTo(62.1371, within(0.000001));
        assertThat(projection.observations().get(1).mileMarker()).isEqualTo(209.0);
        assertThat(projection.observations().get(1).speedMph()).isNull();
        assertThat(projection.speeds()).hasSize(1);
        assertThat(projection.speeds().get(0)).isCloseTo(62.1371, within(0.000001));
    }

    private static TileFlowProjector.FlowCandidate pointCandidate(double speed, double metersNorth) {
        double latitude = Math.toDegrees(metersNorth / 6371008.8);
        return new TileFlowProjector.FlowCandidate(speed, List.of(List.of(new double[]{latitude, 0})));
    }

    private static TileFlowProjector.FlowCandidate candidate(double speed, double lon) {
        return new TileFlowProjector.FlowCandidate(speed,
            List.of(List.of(new double[]{39.70, lon}, new double[]{39.72, lon})));
    }

    private static DecodedTrafficFeature feature(Map<String, Object> tags) {
        return new DecodedTrafficFeature("Traffic flow",
            List.of(List.of(new double[]{39.70, -105}, new double[]{39.72, -105})), tags);
    }

    private static TrafficProps.Corridor corridor() {
        return new TrafficProps.Corridor("I70", "I70", "I-70", "E", "W", 260.0, 261.0,
            List.of(), "0,0,0,0.01", null, null, 550.0);
    }
}
