package com.example.ingest_service;

import java.util.List;
import java.util.Map;
import org.springframework.stereotype.Component;

@Component
public class TomTomTileFlowProvider implements TrafficFlowProvider {

    private final TileTrafficPoller tileTrafficPoller;
    private final TrafficProps trafficProps;

    public TomTomTileFlowProvider(TileTrafficPoller tileTrafficPoller, TrafficProps trafficProps) {
        this.tileTrafficPoller = tileTrafficPoller;
        this.trafficProps = trafficProps;
    }

    @Override
    public String providerName() {
        return "tomtom";
    }

    @Override
    public Map<String, ProviderCycleSnapshot> poll(List<TrafficProps.Corridor> corridors) {
        return tileTrafficPoller.pollFlowAndPersist(corridors, trafficProps.tomtomApiKey());
    }
}
