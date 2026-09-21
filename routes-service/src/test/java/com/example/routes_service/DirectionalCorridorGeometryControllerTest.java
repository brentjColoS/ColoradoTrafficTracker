package com.example.routes_service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Test;
import org.springframework.core.io.DefaultResourceLoader;
import org.springframework.core.io.ResourceLoader;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.test.web.reactive.server.WebTestClient;
import org.springframework.web.server.ResponseStatusException;

class DirectionalCorridorGeometryControllerTest {

    @Test
    void directionsReturnsBothI25CarriagewaysWithBrowserCaching() {
        DirectionalCorridorGeometryController controller = new DirectionalCorridorGeometryController(
            new ObjectMapper(),
            new DefaultResourceLoader()
        );

        WebTestClient.bindToController(controller)
            .build()
            .get()
            .uri("/routes/corridors/I-25/directions")
            .exchange()
            .expectStatus().isOk()
            .expectHeader().contentType("application/geo+json")
            .expectHeader().valueEquals(HttpHeaders.CACHE_CONTROL, "max-age=86400, public")
            .expectBody()
            .jsonPath("$.type").isEqualTo("FeatureCollection")
            .jsonPath("$.properties.corridor").isEqualTo("I25")
            .jsonPath("$.properties.geometryVersion").isEqualTo(1)
            .jsonPath("$.features.length()").isEqualTo(2)
            .jsonPath("$.features[0].properties.direction").isEqualTo("NORTHBOUND")
            .jsonPath("$.features[1].properties.direction").isEqualTo("SOUTHBOUND");
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
