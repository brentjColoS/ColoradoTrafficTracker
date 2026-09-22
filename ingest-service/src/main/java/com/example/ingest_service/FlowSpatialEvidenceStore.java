package com.example.ingest_service;

import java.util.Comparator;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.ConcurrentHashMap;
import org.springframework.stereotype.Component;

@Component
public class FlowSpatialEvidenceStore {
    private final Map<String, FlowSpatialEvidence> evidenceByCorridor = new ConcurrentHashMap<>();

    public void record(FlowSpatialEvidence evidence) {
        if (evidence == null || evidence.corridor() == null || evidence.corridor().isBlank()) return;
        evidenceByCorridor.put(normalize(evidence.corridor()), evidence);
    }

    public Optional<FlowSpatialEvidence> latest(String corridor) {
        if (corridor == null || corridor.isBlank()) return Optional.empty();
        return Optional.ofNullable(evidenceByCorridor.get(normalize(corridor)));
    }

    public List<FlowSpatialEvidence> snapshot() {
        return evidenceByCorridor.values().stream()
            .sorted(Comparator.comparing(FlowSpatialEvidence::corridor))
            .toList();
    }

    private static String normalize(String corridor) {
        return corridor.trim().toUpperCase(Locale.ROOT);
    }
}
