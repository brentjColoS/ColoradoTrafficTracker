package com.example.routes_service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.core.io.DefaultResourceLoader;

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
}
