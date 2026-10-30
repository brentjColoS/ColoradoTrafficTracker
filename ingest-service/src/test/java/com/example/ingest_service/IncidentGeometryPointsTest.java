package com.example.ingest_service;

import static org.assertj.core.api.Assertions.assertThat;

import com.example.common.IncidentGeometryPoints;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;

class IncidentGeometryPointsTest {
    private final ObjectMapper mapper = new ObjectMapper();

    @Test
    void preservesCoordinateOrderAndSkipsShortPairsAcrossLines() throws Exception {
        var points = IncidentGeometryPoints.geometryPoints(mapper.readTree("""
            {"type":"MultiLineString","coordinates":[
                [[-106,40],null,[],[1]],[],[[-105,39,900],["-104.5","38.5"]]]}
            """));
        assertThat(points).hasSize(3);
        assertThat(points.get(0)).containsExactly(40, -106);
        assertThat(points.get(1)).containsExactly(39, -105);
        assertThat(points.get(2)).containsExactly(38.5, -104.5);
    }

    @Test
    void supportsPointsAndRetainsEmptyUnsupportedGeometry() throws Exception {
        assertThat(IncidentGeometryPoints.geometryPoints(mapper.readTree(
            "{\"type\":\"Point\",\"coordinates\":[-105,39]}"))).singleElement()
            .satisfies(point -> assertThat(point).containsExactly(39, -105));
        assertThat(IncidentGeometryPoints.geometryPoints(null)).isEmpty();
        assertThat(IncidentGeometryPoints.geometryPoints(mapper.readTree("{}"))).isEmpty();
        assertThat(IncidentGeometryPoints.geometryPoints(mapper.readTree(
            "{\"type\":\"Polygon\",\"coordinates\":[[[-105,39]]]}"))).isEmpty();
    }
}
