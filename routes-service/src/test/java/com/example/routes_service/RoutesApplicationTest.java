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
}
