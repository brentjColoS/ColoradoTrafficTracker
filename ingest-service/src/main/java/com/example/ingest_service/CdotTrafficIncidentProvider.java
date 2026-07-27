package com.example.ingest_service;

import java.util.List;
import java.util.Map;
import org.springframework.stereotype.Component;

@Component
public class CdotTrafficIncidentProvider implements TrafficIncidentProvider {

    private final CdotIncidentClient client;
    private final CdotIncidentMapper mapper;
    private final CdotProps props;

    public CdotTrafficIncidentProvider(
        CdotIncidentClient client,
        CdotIncidentMapper mapper,
        CdotProps props
    ) {
        this.client = client;
        this.mapper = mapper;
        this.props = props;
    }

    @Override
    public String providerName() {
        return "cdot";
    }

    @Override
    public Map<String, CorridorIncidentSnapshot> poll(List<TrafficProps.Corridor> corridors) {
        CdotIncidentClient.Feeds feeds = client.fetch(props.apiKey()).block();
        if (feeds == null) {
            throw new IllegalStateException("CDOT incident request completed without a response");
        }
        return mapper.map(feeds, corridors);
    }
}
