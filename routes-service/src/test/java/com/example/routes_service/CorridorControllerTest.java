package com.example.routes_service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.io.IOException;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.core.io.AbstractResource;
import org.springframework.core.io.DefaultResourceLoader;
import org.springframework.core.io.ResourceLoader;

class CorridorControllerTest {

    @Test
    void corridorsReturnsDefensiveCopy() {
        List<RoutesProps.Corridor> configured = new ArrayList<>();
        configured.add(new RoutesProps.Corridor(
            "I25",
            "Interstate 25",
            "I-25",
            "S",
            "N",
            null,
            null,
            null,
            "40.0,-105.0,39.0,-104.0",
            null,
            null,
            550.0
        ));
        CorridorController controller = new CorridorController(new RoutesProps(configured), new DefaultResourceLoader());

        List<RoutesProps.Corridor> returned = controller.corridors();

        assertThat(returned).hasSize(1);
        configured.clear();
        assertThat(returned).hasSize(1);
        assertThatThrownBy(() -> returned.add(new RoutesProps.Corridor("I70", null, null, null, null, null, null, null, "x", null, null, null)))
            .isInstanceOf(UnsupportedOperationException.class);
    }

    @Test
    void corridorsReturnsEmptyWhenNotConfigured() {
        CorridorController controller = new CorridorController(new RoutesProps(null), new DefaultResourceLoader());

        assertThat(controller.corridors()).isEmpty();
    }

    @Test
    void corridorsHydratesConfiguredGeometryResource() {
        List<RoutesProps.Corridor> configured = List.of(new RoutesProps.Corridor(
            "I25",
            "Interstate 25",
            "I-25",
            "S",
            "N",
            null,
            null,
            null,
            "40.0,-105.0,39.0,-104.0",
            null,
            "routes/i25.geojson",
            550.0
        ));
        CorridorController controller = new CorridorController(new RoutesProps(configured), new DefaultResourceLoader());

        List<RoutesProps.Corridor> returned = controller.corridors();

        assertThat(returned).hasSize(1);
        assertThat(returned.get(0).geometryJson()).contains("\"LineString\"");
        assertThat(returned.get(0).geometryJson()).contains("-105.001464");
    }

    @Test
    void corridorsKeepsInlineGeometryWithoutLoadingResource() {
        String inlineGeometry = "{\"type\":\"LineString\",\"coordinates\":[[-105.0,39.7],[-104.9,39.8]]}";
        RoutesProps.Corridor configuredCorridor = new RoutesProps.Corridor(
            "I25",
            "Interstate 25",
            "I-25",
            "S",
            "N",
            null,
            null,
            null,
            "40.0,-105.0,39.0,-104.0",
            inlineGeometry,
            "routes/does-not-matter.geojson",
            550.0
        );
        CorridorController controller = new CorridorController(
            new RoutesProps(List.of(configuredCorridor)),
            new ResourceLoader() {
                @Override
                public org.springframework.core.io.Resource getResource(String location) {
                    throw new AssertionError("Resource loader should not be called when geometryJson is already configured");
                }

                @Override
                public ClassLoader getClassLoader() {
                    return getClass().getClassLoader();
                }
            }
        );

        List<RoutesProps.Corridor> returned = controller.corridors();

        assertThat(returned).singleElement().extracting(RoutesProps.Corridor::geometryJson).isEqualTo(inlineGeometry);
    }

    @Test
    void corridorsLeavesGeometryEmptyWhenNoResourceIsConfigured() {
        RoutesProps.Corridor configuredCorridor = new RoutesProps.Corridor(
            "I70",
            "Interstate 70",
            "I-70",
            "E",
            "W",
            null,
            null,
            null,
            "40.0,-105.0,39.0,-104.0",
            null,
            "   ",
            550.0
        );
        CorridorController controller = new CorridorController(
            new RoutesProps(List.of(configuredCorridor)),
            new ResourceLoader() {
                @Override
                public org.springframework.core.io.Resource getResource(String location) {
                    throw new AssertionError("Resource loader should not be called when geometryResource is blank");
                }

                @Override
                public ClassLoader getClassLoader() {
                    return getClass().getClassLoader();
                }
            }
        );

        List<RoutesProps.Corridor> returned = controller.corridors();

        assertThat(returned).singleElement().extracting(RoutesProps.Corridor::geometryJson).isNull();
    }

    @Test
    void corridorsAcceptsClasspathPrefixedGeometryResource() {
        RoutesProps.Corridor configuredCorridor = new RoutesProps.Corridor(
            "I25",
            "Interstate 25",
            "I-25",
            "S",
            "N",
            null,
            null,
            null,
            "40.0,-105.0,39.0,-104.0",
            null,
            "classpath:routes/i25.geojson",
            550.0
        );
        CorridorController controller = new CorridorController(new RoutesProps(List.of(configuredCorridor)), new DefaultResourceLoader());

        List<RoutesProps.Corridor> returned = controller.corridors();

        assertThat(returned).singleElement().extracting(RoutesProps.Corridor::geometryJson).asString().contains("\"LineString\"");
    }

    @Test
    void corridorsThrowsWhenGeometryResourceCannotBeRead() {
        RoutesProps.Corridor configuredCorridor = new RoutesProps.Corridor(
            "I25",
            "Interstate 25",
            "I-25",
            "S",
            "N",
            null,
            null,
            null,
            "40.0,-105.0,39.0,-104.0",
            null,
            "routes/missing.geojson",
            550.0
        );
        ResourceLoader failingLoader = new ResourceLoader() {
            @Override
            public org.springframework.core.io.Resource getResource(String location) {
                return new AbstractResource() {
                    @Override
                    public java.io.InputStream getInputStream() throws IOException {
                        throw new IOException("boom");
                    }

                    @Override
                    public String getDescription() {
                        return location;
                    }
                };
            }

            @Override
            public ClassLoader getClassLoader() {
                return getClass().getClassLoader();
            }
        };
        CorridorController controller = new CorridorController(new RoutesProps(List.of(configuredCorridor)), failingLoader);

        assertThatThrownBy(controller::corridors)
            .isInstanceOf(java.io.UncheckedIOException.class)
            .hasMessageContaining("Unable to read corridor geometry resource routes/missing.geojson");
    }
}
