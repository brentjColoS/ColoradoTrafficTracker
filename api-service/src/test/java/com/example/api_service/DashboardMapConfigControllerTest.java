package com.example.api_service;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

class DashboardMapConfigControllerTest {

    @Test
    void fallsBackToUsgsWhenTracestrackIsNotConfigured() {
        DashboardMapConfigController.DashboardMapConfig config = new DashboardMapConfigController(
            new DashboardMapProps("")
        ).config();

        assertThat(config.provider()).isEqualTo("USGS_IMAGERY");
        assertThat(config.tileUrl()).isNull();
        assertThat(config.attribution()).isNull();
        assertThat(config.maxZoom()).isEqualTo(16);
    }

    @Test
    void returnsARefererRestrictedBrowserTileTemplate() {
        DashboardMapConfigController.DashboardMapConfig config = new DashboardMapConfigController(
            new DashboardMapProps("map key/one")
        ).config();

        assertThat(config.provider()).isEqualTo("TRACESTRACK_TOPO");
        assertThat(config.tileUrl()).isEqualTo(
            "https://tile.tracestrack.com/topo_en/{z}/{x}/{y}@1x.webp?key=map+key%2Fone"
        );
        assertThat(config.attribution()).contains("OpenStreetMap contributors").contains("Maps © Tracestrack");
        assertThat(config.maxZoom()).isEqualTo(19);
    }
}
