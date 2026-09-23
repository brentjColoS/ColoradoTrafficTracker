package com.example.ingest_service;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Instant;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;

class CorridorFlowCellControllerTest {

    @Test
    void returnsBoundedCurrentSnapshotsByCorridor() {
        CorridorFlowCellStore store = new CorridorFlowCellStore();
        store.recordBatch(List.of(snapshot("I70"), snapshot("I25")));
        CorridorFlowCellController controller = new CorridorFlowCellController(store);

        var all = controller.latest(null);
        var one = controller.latest("i70");

        assertThat(all.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(all.getBody()).extracting(CorridorFlowCellSnapshot::corridor)
            .containsExactly("I25", "I70");
        assertThat(one.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(one.getBody()).singleElement()
            .extracting(CorridorFlowCellSnapshot::corridor)
            .isEqualTo("I70");
    }

    @Test
    void distinguishesInvalidAndUnavailableCorridors() {
        CorridorFlowCellController controller = new CorridorFlowCellController(new CorridorFlowCellStore());

        assertThat(controller.latest(" ").getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
        assertThat(controller.latest("I25").getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND);
    }

    private static CorridorFlowCellSnapshot snapshot(String corridor) {
        return new CorridorFlowCellSnapshot(
            corridor,
            Instant.parse("2026-09-23T07:00:00Z"),
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
