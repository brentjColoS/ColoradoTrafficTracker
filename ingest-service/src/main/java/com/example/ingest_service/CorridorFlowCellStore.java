package com.example.ingest_service;

import java.util.Collection;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.atomic.AtomicReference;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DataAccessException;
import org.springframework.stereotype.Component;

@Component
class CorridorFlowCellStore {
    private static final Logger log = LoggerFactory.getLogger(CorridorFlowCellStore.class);

    private final CorridorFlowCellCurrentWriter currentWriter;
    private final AtomicReference<Map<String, CorridorFlowCellSnapshot>> snapshots =
        new AtomicReference<>(Map.of());

    CorridorFlowCellStore(CorridorFlowCellCurrentWriter currentWriter) {
        this.currentWriter = currentWriter;
    }

    void recordBatch(Collection<CorridorFlowCellSnapshot> batch) {
        if (batch == null || batch.isEmpty()) return;
        try {
            currentWriter.replace(batch);
        } catch (DataAccessException exception) {
            log.warn(
                "Current flow-cell persistence failed; keeping the coherent in-memory batch. "
                    + "Check database connectivity and migration state: {}",
                exception.getMessage()
            );
        }
        snapshots.updateAndGet(current -> {
            Map<String, CorridorFlowCellSnapshot> next = new LinkedHashMap<>(current);
            for (CorridorFlowCellSnapshot snapshot : batch) {
                if (snapshot == null || snapshot.corridor() == null || snapshot.corridor().isBlank()) continue;
                next.put(normalize(snapshot.corridor()), snapshot);
            }
            return Map.copyOf(next);
        });
    }

    Optional<CorridorFlowCellSnapshot> latest(String corridor) {
        if (corridor == null || corridor.isBlank()) return Optional.empty();
        return Optional.ofNullable(snapshots.get().get(normalize(corridor)));
    }

    List<CorridorFlowCellSnapshot> snapshot() {
        return snapshots.get().values().stream()
            .sorted(Comparator.comparing(CorridorFlowCellSnapshot::corridor))
            .toList();
    }

    private static String normalize(String corridor) {
        return corridor.trim().toUpperCase(Locale.ROOT);
    }
}
