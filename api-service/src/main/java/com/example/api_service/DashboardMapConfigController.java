package com.example.api_service;

import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class DashboardMapConfigController {
    private static final String TRACESTRACK_ATTRIBUTION =
        "Data: © OpenStreetMap contributors, SRTM, GEBCO, SONNY's LiDAR DTM, "
            + "NASADEM, ESA WorldCover; Maps © Tracestrack";
    private final DashboardMapProps props;

    public DashboardMapConfigController(DashboardMapProps props) {
        this.props = props;
    }

    @GetMapping({"/api/map/config", "/dashboard-api/map/config"})
    public DashboardMapConfig config() {
        if (!props.tracestrackEnabled()) {
            return new DashboardMapConfig("USGS_IMAGERY", null, null, null, 16, 0);
        }
        String key = URLEncoder.encode(props.tracestrackApiKey().trim(), StandardCharsets.UTF_8);
        return new DashboardMapConfig(
            "TRACESTRACK_TOPO",
            "https://tile.tracestrack.com/topo_en/{z}/{x}/{y}@1x.webp?key=" + key,
            "https://tile.tracestrack.com/en/{z}/{x}/{y}@1x.webp?key=" + key,
            TRACESTRACK_ATTRIBUTION,
            19,
            10
        );
    }

    public record DashboardMapConfig(
        String provider,
        String tileUrl,
        String overviewTileUrl,
        String attribution,
        int maxZoom,
        int detailMinZoom
    ) {}
}
