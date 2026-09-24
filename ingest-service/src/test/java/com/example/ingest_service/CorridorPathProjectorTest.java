package com.example.ingest_service;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import org.junit.jupiter.api.Test;

class CorridorPathProjectorTest {
    private static final List<double[]> ROUTE = List.of(
        point(39.7000, -105.0000),
        point(39.7200, -105.0000),
        point(39.7400, -105.0000)
    );

    @Test
    void clipsAPathAtTheCorridorBoundary() {
        CorridorPathProjector projector = new CorridorPathProjector(ROUTE);

        CorridorPathProjector.PathProjection projection = projector.longestContiguousPortion(
            List.of(
                point(39.7020, -104.9998),
                point(39.7120, -104.9998),
                point(39.7320, -104.9500)
            ),
            500.0
        );

        assertThat(projection).isNotNull();
        assertThat(projection.path()).hasSize(3);
        assertThat(projection.maximumRouteDistanceMeters()).isLessThanOrEqualTo(500.0);
        assertThat(projection.meanRouteDistanceMeters()).isLessThanOrEqualTo(500.0);
        assertThat(projection.pathLengthMeters()).isLessThan(2_500.0);
        assertThat(projection.routeOrderDeltaMeters()).isPositive();
    }

    @Test
    void selectsTheLongestMatchingRunAndPreservesRouteOrder() {
        CorridorPathProjector projector = new CorridorPathProjector(ROUTE);

        CorridorPathProjector.PathProjection projection = projector.longestContiguousPortion(
            List.of(
                point(39.7020, -104.9998),
                point(39.7120, -104.9998),
                point(39.7200, -104.9500),
                point(39.7300, -104.9998),
                point(39.7330, -104.9998)
            ),
            500.0
        );

        assertThat(projection).isNotNull();
        assertThat(projection.routeStartMeters()).isLessThan(projection.routeEndMeters());
        assertThat(projection.routeStartMeters()).isLessThan(500.0);
        assertThat(projection.routeEndMeters()).isLessThan(2_000.0);
    }

    @Test
    void reportsReverseRouteOrderWithoutNamingATravelDirection() {
        CorridorPathProjector projector = new CorridorPathProjector(ROUTE);

        CorridorPathProjector.PathProjection projection = projector.longestContiguousPortion(
            List.of(
                point(39.7300, -105.0002),
                point(39.7200, -105.0002)
            ),
            500.0
        );

        assertThat(projection).isNotNull();
        assertThat(projection.routeOrderDeltaMeters()).isNegative();
        assertThat(projection.routeSpanMeters()).isPositive();
        assertThat(projector.routeLengthMeters()).isGreaterThan(projection.routeSpanMeters());
    }

    @Test
    void rejectsAPathOutsideTheCorridorBuffer() {
        CorridorPathProjector projector = new CorridorPathProjector(ROUTE);

        assertThat(projector.longestContiguousPortion(
            List.of(
                point(39.7020, -104.9500),
                point(39.7320, -104.9500)
            ),
            500.0
        )).isNull();
    }

    private static double[] point(double latitude, double longitude) {
        return new double[]{latitude, longitude};
    }
}
