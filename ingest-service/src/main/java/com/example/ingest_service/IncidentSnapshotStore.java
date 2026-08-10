package com.example.ingest_service;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.atomic.AtomicReference;
import org.springframework.stereotype.Component;

@Component
public class IncidentSnapshotStore {

    private final AtomicReference<Map<String, CorridorIncidentSnapshot>> snapshots =
        new AtomicReference<>(Map.of());

    public Optional<CorridorIncidentSnapshot> latest(String corridor) {
        if (corridor == null || corridor.isBlank()) return Optional.empty();
        return Optional.ofNullable(snapshots.get().get(corridor));
    }

    public Map<String, CorridorIncidentSnapshot> snapshot() {
        return snapshots.get();
    }

    public void replace(Map<String, CorridorIncidentSnapshot> next) {
        snapshots.set(next == null ? Map.of() : Map.copyOf(new LinkedHashMap<>(next)));
    }
}
