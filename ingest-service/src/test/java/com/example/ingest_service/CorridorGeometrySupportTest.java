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

    @Test
    void pointsFromGeoJsonReadsLineStringAsLatLonPairs() {
        List<double[]> points = CorridorGeometrySupport.pointsFromGeoJson(
            "{\"type\":\"LineString\",\"coordinates\":[[-105.001464,40.589034],[-104.999409,39.711595]]}"
        );

        assertThat(points).hasSize(2);
        assertThat(points.get(0)).containsExactly(40.589034, -105.001464);
        assertThat(points.get(1)).containsExactly(39.711595, -104.999409);
    }
}
