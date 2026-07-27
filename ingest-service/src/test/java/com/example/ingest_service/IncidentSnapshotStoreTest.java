package com.example.ingest_service;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Instant;
import java.util.Map;
import org.junit.jupiter.api.Test;

class IncidentSnapshotStoreTest {

    @Test
    void failedOrPartialWorkCannotMutateThePublishedSnapshot() {
        IncidentSnapshotStore store = new IncidentSnapshotStore();
        CorridorIncidentSnapshot original = new CorridorIncidentSnapshot(
            "I25",
            "cdot",
            "current-incidents",
            Instant.parse("2026-07-27T12:00:00Z"),
            Instant.parse("2026-07-27T11:58:00Z"),
            "{\"incidents\":[{\"id\":\"one\"}]}",
            1
        );
        store.replace(Map.of("I25", original));

        Map<String, CorridorIncidentSnapshot> unpublished = new java.util.LinkedHashMap<>();
        unpublished.put("I70", new CorridorIncidentSnapshot(
            "I70",
            "cdot",
            "current-incidents",
            Instant.parse("2026-07-27T12:15:00Z"),
            null,
            null,
            0
        ));

        assertThat(store.latest("I25")).contains(original);
        assertThat(store.latest("I70")).isEmpty();
        assertThat(store.snapshot()).isUnmodifiable();
    }
}
