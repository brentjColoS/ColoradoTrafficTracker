package com.example.ingest_service;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

class CorridorFlowCellGridTest {

    @Test
    void createsStableHalfMileCellsAcrossTheTrackedI25Window() {
        var cells = CorridorFlowCellGrid.between("i25", 271.0, 208.0);

        assertThat(cells).hasSize(126);
        assertThat(cells.get(0)).isEqualTo(new CorridorFlowCellGrid.Cell(
            "I25:208.000-208.500", "I25", 0, 208.0, 208.5
        ));
        assertThat(cells.get(cells.size() - 1)).isEqualTo(new CorridorFlowCellGrid.Cell(
            "I25:270.500-271.000", "I25", 125, 270.5, 271.0
        ));
    }

    @Test
    void keepsAPartialFinalCellInsideTheTrackedRange() {
        var cells = CorridorFlowCellGrid.between("I70", 206.0, 207.2);

        assertThat(cells).extracting(CorridorFlowCellGrid.Cell::id).containsExactly(
            "I70:206.000-206.500",
            "I70:206.500-207.000",
            "I70:207.000-207.200"
        );
    }

    @Test
    void rejectsMissingOrDegenerateRanges() {
        assertThat(CorridorFlowCellGrid.between(null, 208.0, 271.0)).isEmpty();
        assertThat(CorridorFlowCellGrid.between("I25", null, 271.0)).isEmpty();
        assertThat(CorridorFlowCellGrid.between("I25", 208.0, 208.0)).isEmpty();
        assertThat(CorridorFlowCellGrid.between("I25", Double.NaN, 271.0)).isEmpty();
    }
}
