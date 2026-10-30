package com.example.ingest_service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.data.Offset.offset;

import java.util.List;
import org.junit.jupiter.api.Test;

class PollerDistanceTest {
    @Test
    void clampsToEndpointsAndHandlesRepeatedVertices() {
        assertThat(CorridorGeometrySupport.distancePointToSegmentMeters(0, 0, 0, 1, 0, 2))
            .isCloseTo(111320, offset(1e-9));
        assertThat(CorridorGeometrySupport.distancePointToSegmentMeters(0, 3, 0, 1, 0, 2))
            .isCloseTo(111320, offset(1e-9));
        assertThat(CorridorGeometrySupport.distancePointToSegmentMeters(0, 0, 1, 0, 1, 0))
            .isCloseTo(111320, offset(1e-9));
    }

    @Test
    void projectsInsideSegmentsAndChoosesTheNearestPolylineLeg() {
        assertThat(CorridorGeometrySupport.distancePointToSegmentMeters(0, 1, 0, 0, 0, 2)).isZero();
        assertThat(CorridorGeometrySupport.minDistanceMetersToPolyline(0, 1, List.of(
            new double[]{1, 0}, new double[]{1, 2}, new double[]{0, 1}))).isZero();
    }

    @Test
    void shortPolylinesHaveNoUsableSegment() {
        assertThat(CorridorGeometrySupport.minDistanceMetersToPolyline(39, -105, List.of())).isInfinite();
        assertThat(CorridorGeometrySupport.minDistanceMetersToPolyline(39, -105,
            List.of(new double[]{39, -105}))).isInfinite();
    }
}
