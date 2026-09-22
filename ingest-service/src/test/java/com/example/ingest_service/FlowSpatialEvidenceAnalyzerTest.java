package com.example.ingest_service;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

class FlowSpatialEvidenceAnalyzerTest {

    private static final Instant OBSERVED_AT = Instant.parse("2026-09-20T18:00:00Z");
    private static final List<double[]> NORTHBOUND_ROUTE = List.of(
        point(39.7000, -105.0000),
        point(39.7200, -105.0000),
        point(39.7400, -105.0000)
    );

    @Test
    void summarizesUniqueDirectionalEvidenceWithoutNamingTravelDirections() {
        DecodedTrafficFeature forward = feature(
            List.of(point(39.7020, -104.9998), point(39.7120, -104.9998)),
            Map.of(
                "road_type", "Motorway",
                "traffic_level", 42,
                "traffic_road_coverage", "one_side"
            )
        );
        DecodedTrafficFeature reversedDuplicate = feature(
            List.of(point(39.7120, -104.9998), point(39.7020, -104.9998)),
            Map.of(
                "road_type", "Motorway",
                "traffic_level", 42,
                "traffic_road_coverage", "one_side"
            )
        );
        DecodedTrafficFeature reverseClosure = feature(
            List.of(point(39.7330, -105.0002), point(39.7200, -105.0002)),
            Map.of(
                "road_type", "Motorway",
                "traffic_level", 0,
                "traffic_road_coverage", "one_side",
                "road_closure", true
            )
        );

        FlowSpatialEvidence evidence = FlowSpatialEvidenceAnalyzer.analyze(
            "I25", 10, OBSERVED_AT,
            List.of(forward, reversedDuplicate, reverseClosure),
            NORTHBOUND_ROUTE,
            500.0
        );

        assertThat(evidence.status()).isEqualTo("OBSERVED");
        assertThat(evidence.decodedFeatureCount()).isEqualTo(3);
        assertThat(evidence.corridorFeatureCount()).isEqualTo(3);
        assertThat(evidence.uniqueFeatureCount()).isEqualTo(2);
        assertThat(evidence.duplicateFeatureCount()).isEqualTo(1);
        assertThat(evidence.oneSideFeatureCount()).isEqualTo(2);
        assertThat(evidence.closureFeatureCount()).isEqualTo(1);
        assertThat(evidence.routeOrderForwardFeatureCount()).isEqualTo(1);
        assertThat(evidence.routeOrderReverseFeatureCount()).isEqualTo(1);
        assertThat(evidence.ambiguousOrientationFeatureCount()).isZero();
        assertThat(evidence.detail()).contains("not validated travel directions");
        assertThat(evidence.routeSpanMiles().median()).isBetween(0.65, 0.90);
    }

    @Test
    void rejectsUnsupportedRoadsAndFeaturesOutsideTheCorridorBuffer() {
        DecodedTrafficFeature localRoad = feature(
            List.of(point(39.7050, -105.0000), point(39.7150, -105.0000)),
            Map.of("road_type", "Local road", "traffic_level", 30)
        );
        DecodedTrafficFeature distantMotorway = feature(
            List.of(point(39.7050, -104.9800), point(39.7150, -104.9800)),
            Map.of("road_type", "Motorway", "traffic_level", 55)
        );

        FlowSpatialEvidence evidence = FlowSpatialEvidenceAnalyzer.analyze(
            "I25", 10, OBSERVED_AT,
            List.of(localRoad, distantMotorway),
            NORTHBOUND_ROUTE,
            500.0
        );

        assertThat(evidence.status()).isEqualTo("NO_MATCHING_FEATURES");
        assertThat(evidence.decodedFeatureCount()).isEqualTo(2);
        assertThat(evidence.corridorFeatureCount()).isZero();
        assertThat(evidence.uniqueFeatureCount()).isZero();
        assertThat(evidence.featureLengthMiles().median()).isNull();
    }

    @Test
    void reportsMissingRouteWithoutMakingSpatialClaims() {
        FlowSpatialEvidence evidence = FlowSpatialEvidenceAnalyzer.analyze(
            "I70", 10, OBSERVED_AT,
            List.of(feature(
                List.of(point(39.70, -105.50), point(39.70, -105.49)),
                Map.of("road_type", "Motorway", "traffic_level", 45)
            )),
            List.of(),
            500.0
        );

        assertThat(evidence.status()).isEqualTo("ROUTE_UNAVAILABLE");
        assertThat(evidence.decodedFeatureCount()).isEqualTo(1);
        assertThat(evidence.uniqueFeatureCount()).isZero();
        assertThat(evidence.detail()).contains("no spatial claims");
    }

    private static DecodedTrafficFeature feature(List<double[]> path, Map<String, Object> tags) {
        return new DecodedTrafficFeature("Traffic flow", List.of(path), tags);
    }

    private static double[] point(double latitude, double longitude) {
        return new double[]{latitude, longitude};
    }
}
