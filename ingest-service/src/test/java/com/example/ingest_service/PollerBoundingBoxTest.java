package com.example.ingest_service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

class PollerBoundingBoxTest {
    @ParameterizedTest
    @ValueSource(strings = {"40,-105,39,-104", "-105,40,-104,39", "39,-104,40,-105", " 40 , -105 , 39 , -104 "})
    void acceptsEitherCoordinateOrderAndReversedCorners(String bbox) {
        assertThat(CorridorGeometrySupport.normalizeBbox(bbox)).containsExactly(39, -105, 40, -104);
    }

    @Test
    void expandsZeroWidthAndHeightForTileCoverage() {
        assertThat(CorridorGeometrySupport.normalizeBbox("40,-105,40,-105"))
            .containsExactly(40 - 1e-6, -105 - 1e-6, 40 + 1e-6, -105 + 1e-6);
    }

    @Test
    void rejectsMalformedBoundsWithTheExistingReason() {
        assertThatThrownBy(() -> CorridorGeometrySupport.normalizeBbox("40,-105,39"))
            .isInstanceOf(IllegalArgumentException.class).hasMessage("bbox must be 'lat1,lon1,lat2,lon2'");
        assertThatThrownBy(() -> CorridorGeometrySupport.normalizeBbox("x,-105,39,-104"))
            .isInstanceOf(NumberFormatException.class);
    }
}
