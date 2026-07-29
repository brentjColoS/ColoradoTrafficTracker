package com.example.ingest_service;

import java.util.List;
import java.util.Map;
import org.springframework.stereotype.Component;

@Component
public class TomTomTileIncidentProvider implements TrafficIncidentProvider {

    private final TileTrafficPoller tileTrafficPoller;

    public TomTomTileIncidentProvider(TileTrafficPoller tileTrafficPoller) {
        this.tileTrafficPoller = tileTrafficPoller;
    }

    @Override
    public String providerName() {
        return "tomtom";
    }

    @Override
    public Map<String, CorridorIncidentSnapshot> poll(List<TrafficProps.Corridor> corridors) {
        return tileTrafficPoller.pollIncidents(corridors);
    }
}
