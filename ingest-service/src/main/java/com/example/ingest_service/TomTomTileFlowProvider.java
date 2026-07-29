package com.example.ingest_service;

import java.util.List;
import java.util.Map;
import org.springframework.stereotype.Component;

@Component
public class TomTomTileFlowProvider implements TrafficFlowProvider {

    private final TileTrafficPoller tileTrafficPoller;

    public TomTomTileFlowProvider(TileTrafficPoller tileTrafficPoller) {
        this.tileTrafficPoller = tileTrafficPoller;
    }

    @Override
    public String providerName() {
        return "tomtom";
    }

    @Override
    public Map<String, ProviderCycleSnapshot> poll(List<TrafficProps.Corridor> corridors) {
        return tileTrafficPoller.pollFlowAndPersist(corridors);
    }
}
