package com.example.ingest_service;

import java.util.List;
import java.util.Map;

public interface TrafficFlowProvider {

    String providerName();

    Map<String, ProviderCycleSnapshot> poll(List<TrafficProps.Corridor> corridors);
}
