package com.example.ingest_service;

import java.util.List;
import java.util.Map;

public interface TrafficIncidentProvider {

    String providerName();

    Map<String, CorridorIncidentSnapshot> poll(List<TrafficProps.Corridor> corridors);
}
