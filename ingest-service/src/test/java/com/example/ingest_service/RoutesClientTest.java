package com.example.ingest_service;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

class RoutesClientTest {
    private final ObjectMapper objectMapper = new ObjectMapper();

    @Test
    void parsesOnlyNamedLineStringCarriageways() throws Exception {
        JsonNode geometry = objectMapper.readTree("""
            {
              "type": "FeatureCollection",
              "features": [
                {
                  "type": "Feature",
                  "properties": {"direction": "northbound"},
                  "geometry": {
                    "type": "LineString",
                    "coordinates": [[-105.0, 39.7], [-104.99, 39.8]]
                  }
                },
                {
                  "type": "Feature",
                  "properties": {"direction": "unknown"},
                  "geometry": {
                    "type": "LineString",
                    "coordinates": [[-105.1, 39.7], [-105.09, 39.8]]
                  }
                },
                {
                  "type": "Feature",
                  "properties": {"direction": "southbound"},
                  "geometry": {"type": "Point", "coordinates": [-105.0, 39.7]}
                }
              ]
            }
            """);

        Map<String, List<double[]>> routes = RoutesClient.parseDirectionalRoutes(geometry);

        assertThat(routes).containsOnlyKeys("NORTHBOUND");
        assertThat(routes.get("NORTHBOUND").get(0)).containsExactly(39.7, -105.0);
    }

    @Test
    void rejectsMissingAndMalformedFeatureCollections() throws Exception {
        assertThat(RoutesClient.parseDirectionalRoutes(null)).isEmpty();
        assertThat(RoutesClient.parseDirectionalRoutes(objectMapper.readTree("{}"))).isEmpty();
        assertThat(RoutesClient.parseDirectionalRoutes(objectMapper.readTree("""
            {"features":[{"properties":{"direction":"eastbound"},"geometry":{"type":"LineString","coordinates":[[null,39.7]]}}]}
            """))).isEmpty();
    }
}
