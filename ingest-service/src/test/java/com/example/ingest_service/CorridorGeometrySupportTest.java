package com.example.ingest_service;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import org.junit.jupiter.api.Test;

class CorridorGeometrySupportTest {

    @Test
    void toGeoJsonLineStringUsesLonLatCoordinateOrder() {
        String geoJson = CorridorGeometrySupport.toGeoJsonLineString(List.of(
            new double[]{39.7392, -104.9903},
            new double[]{39.8561, -104.6737}
        ));

        assertThat(geoJson)
            .isEqualTo("{\"type\":\"LineString\",\"coordinates\":[[-104.990300,39.739200],[-104.673700,39.856100]]}");
    }

    @Test
    void fallbackGeoJsonFromBboxUsesDirectionalAxis() {
        String geoJson = CorridorGeometrySupport.fallbackGeoJsonFromBbox(
            "40.100000,-105.100000,39.900000,-104.900000",
            "N",
            "S"
        );

        assertThat(geoJson)
            .isEqualTo("{\"type\":\"LineString\",\"coordinates\":[[-105.000000,40.100000],[-105.000000,39.900000]]}");
    }
}
