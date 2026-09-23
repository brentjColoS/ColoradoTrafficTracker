package com.example.ingest_service;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Instant;
import java.util.List;
import org.junit.jupiter.api.Test;

class CorridorFlowCellStoreTest {

    @Test
    void publishesACorridorBatchAsOneSnapshot() {
        CorridorFlowCellStore store = new CorridorFlowCellStore();
        store.recordBatch(List.of(snapshot("I25", "2026-09-23T07:00:00Z")));
        store.recordBatch(List.of(
            snapshot("I25", "2026-09-23T07:01:00Z"),
            snapshot("I70", "2026-09-23T07:01:00Z")
        ));

        assertThat(store.snapshot()).extracting(CorridorFlowCellSnapshot::corridor)
            .containsExactly("I25", "I70");
        assertThat(store.snapshot()).extracting(CorridorFlowCellSnapshot::observedAt)
            .containsOnly(Instant.parse("2026-09-23T07:01:00Z"));
        assertThat(store.latest("i25")).isPresent();
    }

    @Test
    void ignoresAnEmptyBatch() {
        CorridorFlowCellStore store = new CorridorFlowCellStore();

        store.recordBatch(List.of());

        assertThat(store.snapshot()).isEmpty();
    }

    private static CorridorFlowCellSnapshot snapshot(String corridor, String observedAt) {
        return new CorridorFlowCellSnapshot(
            corridor,
            Instant.parse(observedAt),
            10,
            "OBSERVED",
            "Combined direction.",
            0.5,
            2,
            0,
            0,
            0,
            List.of()
        );
    }
}
