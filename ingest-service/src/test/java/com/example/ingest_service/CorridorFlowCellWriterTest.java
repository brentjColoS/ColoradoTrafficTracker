package com.example.ingest_service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.lang.reflect.Method;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.annotation.Transactional;

@ExtendWith(MockitoExtension.class)
class CorridorFlowCellWriterTest {

    @Mock
    private JdbcTemplate jdbc;

    @Test
    void replacesTheAcceptedCorridorSnapshotAndItsCells() {
        when(jdbc.update(
            eq(CorridorFlowCellWriter.UPSERT_SNAPSHOT),
            any(Object[].class)
        )).thenReturn(1);
        CorridorFlowCellWriter writer = new CorridorFlowCellWriter(jdbc);

        writer.replace(List.of(snapshot(List.of(cell()))));

        @SuppressWarnings("unchecked")
        ArgumentCaptor<List<Object[]>> rows = ArgumentCaptor.forClass(List.class);
        verify(jdbc).batchUpdate(eq(CorridorFlowCellWriter.UPSERT_CELL), rows.capture());
        assertThat(rows.getValue()).singleElement().satisfies(arguments -> {
            assertThat(arguments[0]).isEqualTo("I25");
            assertThat(arguments[1]).isEqualTo("I25:208.000-208.500");
            assertThat(arguments[2]).isEqualTo(OffsetDateTime.parse("2026-09-23T18:42:17Z"));
            assertThat(arguments[5]).isEqualTo("COMBINED");
            assertThat(arguments[13]).isEqualTo(0.25);
            assertThat(arguments[14]).isEqualTo(0.75);
            assertThat(arguments[15]).isEqualTo(1.5);
            assertThat(arguments[18]).isEqualTo("FULL_CELL");
        });
        @SuppressWarnings("unchecked")
        ArgumentCaptor<List<Object[]>> hourlyRows = ArgumentCaptor.forClass(List.class);
        verify(jdbc).batchUpdate(
            eq(CorridorFlowCellWriter.UPSERT_HOURLY_CELL),
            hourlyRows.capture()
        );
        assertThat(hourlyRows.getValue()).singleElement().satisfies(arguments -> {
            assertThat(arguments[0]).isEqualTo("I25");
            assertThat(arguments[1]).isEqualTo("I25:208.000-208.500");
            assertThat(arguments[2]).isEqualTo("COMBINED");
            assertThat(arguments[3]).isEqualTo(OffsetDateTime.parse("2026-09-23T18:00:00Z"));
            assertThat(arguments[6]).isEqualTo(10);
            assertThat(arguments[7]).isEqualTo(10);
            assertThat(arguments[8]).isEqualTo(1);
            assertThat(arguments[12]).isEqualTo(1);
            assertThat(arguments[13]).isEqualTo(0);
            assertThat(arguments[14]).isEqualTo(0);
            assertThat(arguments[18]).isEqualTo(OffsetDateTime.parse("2026-09-23T18:42:17Z"));
            assertThat(arguments[19]).isEqualTo(OffsetDateTime.parse("2026-09-23T18:42:17Z"));
        });
        verify(jdbc).update(
            CorridorFlowCellWriter.DELETE_STALE_CELLS,
            "I25",
            OffsetDateTime.parse("2026-09-23T18:42:17Z")
        );
        assertThat(CorridorFlowCellWriter.UPSERT_SNAPSHOT)
            .contains("excluded.observed_at >= traffic_flow_cell_snapshot_current.observed_at");
        assertThat(CorridorFlowCellWriter.UPSERT_HOURLY_CELL)
            .contains("excluded.last_observed_at > traffic_flow_cell_hourly.last_observed_at");
    }

    @Test
    void ignoresAnOlderSnapshotRejectedByTheDatabaseGuard() {
        when(jdbc.update(
            eq(CorridorFlowCellWriter.UPSERT_SNAPSHOT),
            any(Object[].class)
        )).thenReturn(0);
        CorridorFlowCellWriter writer = new CorridorFlowCellWriter(jdbc);

        writer.replace(List.of(snapshot(List.of(cell()))));

        verify(jdbc, never()).batchUpdate(anyString(), anyList());
        verify(jdbc, never()).update(
            eq(CorridorFlowCellWriter.DELETE_STALE_CELLS),
            any(Object[].class)
        );
    }

    @Test
    void clearsPreviouslySupportedCellsWhenTheAcceptedSnapshotHasNoCells() {
        when(jdbc.update(
            eq(CorridorFlowCellWriter.UPSERT_SNAPSHOT),
            any(Object[].class)
        )).thenReturn(1);
        CorridorFlowCellWriter writer = new CorridorFlowCellWriter(jdbc);

        writer.replace(List.of(snapshot(List.of())));

        verify(jdbc, never()).batchUpdate(anyString(), anyList());
        verify(jdbc).update(
            CorridorFlowCellWriter.DELETE_STALE_CELLS,
            "I25",
            OffsetDateTime.parse("2026-09-23T18:42:17Z")
        );
    }

    @Test
    void countsPartialCoverageAndReportedClosuresInTheHourlySummary() {
        when(jdbc.update(
            eq(CorridorFlowCellWriter.UPSERT_SNAPSHOT),
            any(Object[].class)
        )).thenReturn(1);
        CorridorFlowCellWriter writer = new CorridorFlowCellWriter(jdbc);
        CorridorFlowCellSnapshot.Cell partialClosure = cell(
            CorridorFlowCellSnapshot.ClosureEvidence.ONE_SIDE_REPORTED,
            CorridorFlowCellSnapshot.Quality.PARTIAL_CELL
        );

        writer.replace(List.of(snapshot(List.of(partialClosure))));

        @SuppressWarnings("unchecked")
        ArgumentCaptor<List<Object[]>> hourlyRows = ArgumentCaptor.forClass(List.class);
        verify(jdbc).batchUpdate(
            eq(CorridorFlowCellWriter.UPSERT_HOURLY_CELL),
            hourlyRows.capture()
        );
        assertThat(hourlyRows.getValue()).singleElement().satisfies(arguments -> {
            assertThat(arguments[12]).isEqualTo(0);
            assertThat(arguments[13]).isEqualTo(1);
            assertThat(arguments[14]).isEqualTo(1);
        });
    }

    @Test
    void replacesTheBatchInOneTransaction() throws Exception {
        Method method = CorridorFlowCellWriter.class.getDeclaredMethod(
            "replace",
            java.util.Collection.class
        );

        assertThat(method.getAnnotation(Transactional.class)).isNotNull();
    }

    private static CorridorFlowCellSnapshot snapshot(List<CorridorFlowCellSnapshot.Cell> cells) {
        return new CorridorFlowCellSnapshot(
            "i25",
            Instant.parse("2026-09-23T18:42:17Z"),
            10,
            cells.isEmpty() ? "NO_MATCHING_PATHS" : "OBSERVED",
            cells.isEmpty() ? "No matching paths." : "Combined direction.",
            0.5,
            126,
            cells.size(),
            cells.size(),
            0,
            cells
        );
    }

    private static CorridorFlowCellSnapshot.Cell cell() {
        return cell(
            CorridorFlowCellSnapshot.ClosureEvidence.NONE,
            CorridorFlowCellSnapshot.Quality.FULL_CELL
        );
    }

    private static CorridorFlowCellSnapshot.Cell cell(
        CorridorFlowCellSnapshot.ClosureEvidence closureEvidence,
        CorridorFlowCellSnapshot.Quality quality
    ) {
        return new CorridorFlowCellSnapshot.Cell(
            "I25:208.000-208.500",
            208.0,
            208.5,
            CorridorFlowCellSnapshot.Direction.COMBINED,
            55.0,
            2,
            1,
            1,
            0,
            closureEvidence,
            0.5,
            0.25,
            0.75,
            1.5,
            207.5,
            209.0,
            quality
        );
    }
}
