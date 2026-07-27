package com.example.ingest_service;

import java.util.List;
import java.util.Map;
import org.springframework.stereotype.Component;

@Component
public class TomTomTileIncidentProvider implements TrafficIncidentProvider {

    private final TileTrafficPoller tileTrafficPoller;
    private final TrafficProps trafficProps;

    public TomTomTileIncidentProvider(TileTrafficPoller tileTrafficPoller, TrafficProps trafficProps) {
        this.tileTrafficPoller = tileTrafficPoller;
        this.trafficProps = trafficProps;
    }

    @Override
    public String providerName() {
        return "tomtom";
    }

    @Override
    public Map<String, CorridorIncidentSnapshot> poll(List<TrafficProps.Corridor> corridors) {
        return tileTrafficPoller.pollIncidents(corridors, trafficProps.tomtomApiKey());
    }
}
