package com.example.routes_service;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.NONE)
class RoutesApplicationTest {

    @Autowired
    private RoutesProps routesProps;

    @Test
    void contextLoadsConfiguredCorridors() {
        assertThat(routesProps).isNotNull();
        assertThat(routesProps.corridors()).isNotNull();
        assertThat(routesProps.corridors()).isNotEmpty();
        assertThat(routesProps.corridors().get(0).name()).isNotBlank();
        assertThat(routesProps.corridors().get(0).bbox()).contains(",");
    }

    @Test
    void i70ConfigurationReachesTheI25Interchange() {
        RoutesProps.Corridor i70 = routesProps.corridors().stream()
            .filter(corridor -> "I70".equals(corridor.name()))
            .findFirst()
            .orElseThrow();

        assertThat(i70.startMileMarker()).isEqualTo(206.0);
        assertThat(i70.endMileMarker()).isEqualTo(274.0);
        assertThat(i70.mileMarkerAnchors()).extracting(RoutesProps.MileMarkerAnchor::mileMarker)
            .contains(259.0, 260.0, 270.0, 274.0);
    }
}
