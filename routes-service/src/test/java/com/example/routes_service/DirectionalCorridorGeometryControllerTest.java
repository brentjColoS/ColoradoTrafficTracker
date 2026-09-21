package com.example.routes_service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Test;
import org.springframework.core.io.DefaultResourceLoader;
import org.springframework.core.io.ResourceLoader;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.server.ResponseStatusException;

class DirectionalCorridorGeometryControllerTest {

    @Test
    void directionsReturnsBothI25CarriagewaysWithBrowserCaching() {
        DirectionalCorridorGeometryController controller = new DirectionalCorridorGeometryController(
            new ObjectMapper(),
            new DefaultResourceLoader()
        );

        ResponseEntity<JsonNode> response = controller.directions("I-25");

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(response.getHeaders().getContentType().toString()).isEqualTo("application/geo+json");
        assertThat(response.getHeaders().getCacheControl()).isEqualTo("max-age=86400, public");
        assertThat(response.getBody()).isNotNull();
        assertThat(response.getBody().path("type").asText()).isEqualTo("FeatureCollection");
        assertThat(response.getBody().path("properties").path("corridor").asText()).isEqualTo("I25");
        assertThat(response.getBody().path("properties").path("geometryVersion").asInt()).isEqualTo(1);
        assertThat(response.getBody().path("features")).hasSize(2);
        assertThat(response.getBody().path("features").get(0).path("properties").path("direction").asText())
            .isEqualTo("NORTHBOUND");
        assertThat(response.getBody().path("features").get(1).path("properties").path("direction").asText())
            .isEqualTo("SOUTHBOUND");
    }

    @Test
    void directionsLoadsEachCorridorResourceOnce() {
        AtomicInteger loadCount = new AtomicInteger();
        DefaultResourceLoader delegate = new DefaultResourceLoader();
        ResourceLoader countingLoader = new ResourceLoader() {
            @Override
            public org.springframework.core.io.Resource getResource(String location) {
                loadCount.incrementAndGet();
                return delegate.getResource(location);
            }

            @Override
            public ClassLoader getClassLoader() {
                return delegate.getClassLoader();
            }
        };
        DirectionalCorridorGeometryController controller = new DirectionalCorridorGeometryController(
            new ObjectMapper(),
            countingLoader
        );

        controller.directions("i70");
        controller.directions("I-70");

        assertThat(loadCount).hasValue(1);
    }

    @Test
    void directionsRejectsUnknownCorridors() {
        DirectionalCorridorGeometryController controller = new DirectionalCorridorGeometryController(
            new ObjectMapper(),
            new DefaultResourceLoader()
        );

        assertThatThrownBy(() -> controller.directions("I76"))
            .isInstanceOfSatisfying(ResponseStatusException.class, error -> {
                assertThat(error.getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND);
                assertThat(error.getReason()).isEqualTo("Directional corridor geometry is unavailable");
            });
    }
}
