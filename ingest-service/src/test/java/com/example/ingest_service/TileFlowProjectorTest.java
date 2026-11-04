package com.example.ingest_service;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import java.util.Map;
import java.util.Set;
import org.junit.jupiter.api.Test;

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
