package com.example.ingest_service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.data.Offset.offset;

import org.junit.jupiter.api.Test;

class IngestionGeodesicDistanceTest {
    @Test
    void coincidentPointsHaveZeroLength() {
        assertThat(CorridorGeometrySupport.haversineMeters(39, -105, 39, -105)).isZero();
    }

    @Test
    void usesTheExistingEarthRadiusAcrossTheEquatorAndMeridian() {
        double oneDegree = 2 * 6371008.8 * Math.asin(Math.sin(Math.toRadians(1) / 2));
        assertThat(CorridorGeometrySupport.haversineMeters(0, 0, 0, 1)).isCloseTo(oneDegree, offset(1e-9));
        assertThat(CorridorGeometrySupport.haversineMeters(0, 0, 1, 0)).isCloseTo(oneDegree, offset(1e-9));
        assertThat(CorridorGeometrySupport.haversineMeters(0, 1, 0, 0)).isCloseTo(oneDegree, offset(1e-9));
    }
}
