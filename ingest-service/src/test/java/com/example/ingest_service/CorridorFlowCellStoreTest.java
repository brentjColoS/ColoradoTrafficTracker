package com.example.ingest_service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;

import java.time.Instant;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.dao.DataAccessResourceFailureException;

class CorridorFlowCellStoreTest {

    @Test
    void publishesACorridorBatchAsOneSnapshot() {
        CorridorFlowCellStore store = flowCellStore();
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
        CorridorFlowCellStore store = flowCellStore();

        store.recordBatch(List.of());

        assertThat(store.snapshot()).isEmpty();
    }

    @Test
    void keepsTheCoherentMemorySnapshotWhenCurrentPersistenceIsUnavailable() {
        CorridorFlowCellWriter writer = mock(CorridorFlowCellWriter.class);
        List<CorridorFlowCellSnapshot> batch = List.of(
            snapshot("I25", "2026-09-23T07:00:00Z")
        );
        org.mockito.Mockito.doThrow(new DataAccessResourceFailureException("database unavailable"))
            .when(writer).replace(batch);
        CorridorFlowCellStore store = new CorridorFlowCellStore(writer);

        store.recordBatch(batch);

        verify(writer).replace(batch);
        assertThat(store.latest("I25")).isPresent();
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

    private static CorridorFlowCellStore flowCellStore() {
        return new CorridorFlowCellStore(mock(CorridorFlowCellWriter.class));
    }
}
