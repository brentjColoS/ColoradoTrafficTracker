package com.example.ingest_service;

import io.micrometer.core.instrument.MeterRegistry;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.stereotype.Component;
import org.springframework.web.reactive.function.client.WebClient;

@Component
final class TomTomTileAccess {
    private static final Logger log = LoggerFactory.getLogger(TomTomTileAccess.class);
    final TileQuotaUsage quotaUsage;
    final TomTomTileClient tileClient;
    final TileCoveragePlanner coveragePlanner;
    private final CorridorGeometryResolver geometryResolver;
    private final TomTomAccountQuotaManager quotaManager;

    TomTomTileAccess(@Qualifier("tomtomWebClient") WebClient http, TrafficProps props,
        TrafficPullProps pullProps, CorridorGeometryStore geometryStore,
        TrafficProviderGuardService guard, TomTomAccountQuotaManager quotaManager,
        TomTomRequestGovernor governor, MeterRegistry registry) {
        this.quotaManager = quotaManager;
        this.coveragePlanner = new TileCoveragePlanner(props.tileZoom());
        this.geometryResolver = new CorridorGeometryResolver(http, geometryStore, guard, governor);
        this.quotaUsage = new TileQuotaUsage(pullProps, quotaManager, registry);
        this.tileClient = new TomTomTileClient(http, guard, quotaManager, quotaUsage);
    }

    boolean hasAccount() {
        return quotaManager.firstAccount().isPresent();
    }

    Map<String, CorridorGeometry> loadGeometry(List<TrafficProps.Corridor> corridors) {
        Map<String, CorridorGeometry> byCorridor = new LinkedHashMap<>();
        CorridorGeometry emptyGeometry = new CorridorGeometry(List.of());

        for (TrafficProps.Corridor corridor : corridors) {
            try {
                CorridorGeometry geometry = geometryResolver.resolve(corridor).blockOptional().orElse(emptyGeometry);
                byCorridor.put(corridor.name(), geometry);
            } catch (Exception e) {
                log.warn("Skipping corridor {} due to geometry setup error: {}", corridor.name(), e.toString());
            }
        }
        return byCorridor;
    }
}
