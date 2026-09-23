package com.example.ingest_service;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

class CorridorFlowCellProjectorTest {
    private static final Instant OBSERVED_AT = Instant.parse("2026-09-23T07:00:00Z");
    private static final List<double[]> ROUTE = List.of(
        point(39.7000, -105.0000),
        point(39.7200, -105.0000),
        point(39.7400, -105.0000)
    );

    @Test
    void projectsUniquePathsIntoCombinedHalfMileCells() {
        DecodedTrafficFeature fullCoverage = feature(
            List.of(point(39.7020, -104.9998), point(39.7120, -104.9998)),
            Map.of(
                "road_type", "Motorway",
                "traffic_level", 40,
                "traffic_road_coverage", "full"
            )
        );
        DecodedTrafficFeature reversedDuplicate = feature(
            List.of(point(39.7120, -104.9998), point(39.7020, -104.9998)),
            Map.of(
                "road_type", "Motorway",
                "traffic_level", 40,
                "traffic_road_coverage", "full"
            )
        );
        DecodedTrafficFeature oneSideClosure = feature(
            List.of(point(39.7070, -105.0002), point(39.7170, -105.0002)),
            Map.of(
                "road_type", "Motorway",
                "traffic_level", 20,
                "traffic_road_coverage", "one_side",
                "road_closure", true
            )
        );

        CorridorFlowCellSnapshot snapshot = CorridorFlowCellProjector.project(
            "I25",
            OBSERVED_AT,
            10,
            14.0,
            10.0,
            List.of(fullCoverage, reversedDuplicate, oneSideClosure),
            ROUTE,
            150.0
        );

        assertThat(snapshot.status()).isEqualTo("OBSERVED");
        assertThat(snapshot.totalCellCount()).isEqualTo(8);
        assertThat(snapshot.supportedCellCount()).isEqualTo(4);
        assertThat(snapshot.uniqueSourcePathCount()).isEqualTo(2);
        assertThat(snapshot.duplicateSourcePathCount()).isEqualTo(1);
        assertThat(snapshot.cells()).extracting(CorridorFlowCellSnapshot.Cell::id).containsExactly(
            "I25:12.000-12.500",
            "I25:12.500-13.000",
            "I25:13.000-13.500",
            "I25:13.500-14.000"
        );

        CorridorFlowCellSnapshot.Cell shared = snapshot.cells().get(2);
        assertThat(shared.direction()).isEqualTo(CorridorFlowCellSnapshot.Direction.COMBINED);
        assertThat(shared.speedMph()).isBetween(19.0, 21.0);
        assertThat(shared.sourcePathCount()).isEqualTo(2);
        assertThat(shared.oneSideSourceCount()).isEqualTo(1);
        assertThat(shared.fullSourceCount()).isEqualTo(1);
        assertThat(shared.closureEvidence())
            .isEqualTo(CorridorFlowCellSnapshot.ClosureEvidence.ONE_SIDE_REPORTED);
        assertThat(shared.coarsestSourceSpanMiles()).isGreaterThan(0.5);
        assertThat(shared.coarsestSourceStartMileMarker()).isLessThan(shared.startMileMarker());
        assertThat(shared.coarsestSourceEndMileMarker()).isGreaterThan(shared.endMileMarker());
        assertThat(shared.quality()).isEqualTo(CorridorFlowCellSnapshot.Quality.FULL_CELL);

        CorridorFlowCellSnapshot.Cell edge = snapshot.cells().get(3);
        assertThat(edge.quality()).isEqualTo(CorridorFlowCellSnapshot.Quality.PARTIAL_CELL);
        assertThat(edge.closureEvidence()).isEqualTo(CorridorFlowCellSnapshot.ClosureEvidence.NONE);
    }

    @Test
    void retainsGapsInsteadOfSpreadingNearbySpeeds() {
        CorridorFlowCellSnapshot snapshot = CorridorFlowCellProjector.project(
            "I70",
            OBSERVED_AT,
            10,
            206.0,
            210.0,
            List.of(feature(
                List.of(point(39.7020, -104.9998), point(39.7040, -104.9998)),
                Map.of("road_type", "Motorway", "traffic_level", 55)
            )),
            ROUTE,
            150.0
        );

        assertThat(snapshot.totalCellCount()).isEqualTo(8);
        assertThat(snapshot.supportedCellCount()).isLessThan(snapshot.totalCellCount());
        assertThat(snapshot.cells()).extracting(CorridorFlowCellSnapshot.Cell::id)
            .containsExactly("I70:206.000-206.500");
        assertThat(snapshot.detail()).contains("no travel direction is inferred");
    }

    @Test
    void rejectsOffCorridorAndUnsupportedRoadEvidence() {
        CorridorFlowCellSnapshot snapshot = CorridorFlowCellProjector.project(
            "I25",
            OBSERVED_AT,
            10,
            14.0,
            10.0,
            List.of(
                feature(
                    List.of(point(39.7020, -104.9500), point(39.7120, -104.9500)),
                    Map.of("road_type", "Motorway", "traffic_level", 55)
                ),
                feature(
                    List.of(point(39.7020, -104.9998), point(39.7120, -104.9998)),
                    Map.of("road_type", "Local road", "traffic_level", 25)
                )
            ),
            ROUTE,
            150.0
        );

        assertThat(snapshot.status()).isEqualTo("NO_MATCHING_PATHS");
        assertThat(snapshot.supportedCellCount()).isZero();
        assertThat(snapshot.cells()).isEmpty();
    }

    @Test
    void explainsUnavailableGeometryAndMarkerRanges() {
        CorridorFlowCellSnapshot missingRoute = CorridorFlowCellProjector.project(
            "I70", OBSERVED_AT, 10, 206.0, 259.0, List.of(), List.of(), 150.0
        );
        CorridorFlowCellSnapshot missingMarkers = CorridorFlowCellProjector.project(
            "I70", OBSERVED_AT, 10, null, 259.0, List.of(), ROUTE, 150.0
        );

        assertThat(missingRoute.status()).isEqualTo("ROUTE_UNAVAILABLE");
        assertThat(missingRoute.detail()).contains("geometry is unavailable");
        assertThat(missingMarkers.status()).isEqualTo("INVALID_MARKER_RANGE");
        assertThat(missingMarkers.detail()).contains("mile-marker range");
    }

    private static DecodedTrafficFeature feature(List<double[]> path, Map<String, Object> tags) {
        return new DecodedTrafficFeature("Traffic flow", List.of(path), tags);
    }

    private static double[] point(double latitude, double longitude) {
        return new double[]{latitude, longitude};
    }
}
