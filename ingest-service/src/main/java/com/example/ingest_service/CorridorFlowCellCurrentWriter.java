package com.example.ingest_service;

import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.Collection;
import java.util.List;
import java.util.Locale;
import java.util.Objects;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

@Component
public class CorridorFlowCellCurrentWriter {
    static final String UPSERT_SNAPSHOT = """
        insert into traffic_flow_cell_snapshot_current (
            corridor,
            observed_at,
            source_zoom,
            status,
            detail,
            cell_size_miles,
            total_cell_count,
            supported_cell_count,
            unique_source_path_count,
            duplicate_source_path_count,
            stored_at
        ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, now())
        on conflict (corridor) do update set
            observed_at = excluded.observed_at,
            source_zoom = excluded.source_zoom,
            status = excluded.status,
            detail = excluded.detail,
            cell_size_miles = excluded.cell_size_miles,
            total_cell_count = excluded.total_cell_count,
            supported_cell_count = excluded.supported_cell_count,
            unique_source_path_count = excluded.unique_source_path_count,
            duplicate_source_path_count = excluded.duplicate_source_path_count,
            stored_at = now()
        where excluded.observed_at >= traffic_flow_cell_snapshot_current.observed_at
        """;

    static final String UPSERT_CELL = """
        insert into traffic_flow_cell_current (
            corridor,
            cell_id,
            observed_at,
            start_mile_marker,
            end_mile_marker,
            direction,
            speed_mph,
            source_path_count,
            one_side_source_count,
            full_source_count,
            unknown_coverage_source_count,
            closure_evidence,
            covered_marker_miles,
            finest_source_span_miles,
            length_weighted_source_span_miles,
            coarsest_source_span_miles,
            coarsest_source_start_mile_marker,
            coarsest_source_end_mile_marker,
            quality
        ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        on conflict (corridor, cell_id, direction) do update set
            observed_at = excluded.observed_at,
            start_mile_marker = excluded.start_mile_marker,
            end_mile_marker = excluded.end_mile_marker,
            speed_mph = excluded.speed_mph,
            source_path_count = excluded.source_path_count,
            one_side_source_count = excluded.one_side_source_count,
            full_source_count = excluded.full_source_count,
            unknown_coverage_source_count = excluded.unknown_coverage_source_count,
            closure_evidence = excluded.closure_evidence,
            covered_marker_miles = excluded.covered_marker_miles,
            finest_source_span_miles = excluded.finest_source_span_miles,
            length_weighted_source_span_miles = excluded.length_weighted_source_span_miles,
            coarsest_source_span_miles = excluded.coarsest_source_span_miles,
            coarsest_source_start_mile_marker = excluded.coarsest_source_start_mile_marker,
            coarsest_source_end_mile_marker = excluded.coarsest_source_end_mile_marker,
            quality = excluded.quality
        """;

    static final String DELETE_STALE_CELLS = """
        delete from traffic_flow_cell_current
        where corridor = ?
          and observed_at <> ?
        """;

    private final JdbcTemplate jdbc;

    public CorridorFlowCellCurrentWriter(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    @Transactional
    public void replace(Collection<CorridorFlowCellSnapshot> snapshots) {
        if (snapshots == null || snapshots.isEmpty()) return;

        snapshots.stream()
            .filter(Objects::nonNull)
            .filter(snapshot -> snapshot.corridor() != null && !snapshot.corridor().isBlank())
            .filter(snapshot -> snapshot.observedAt() != null)
            .forEach(this::replaceCorridor);
    }

    private void replaceCorridor(CorridorFlowCellSnapshot snapshot) {
        String corridor = snapshot.corridor().trim().toUpperCase(Locale.ROOT);
        OffsetDateTime observedAt = OffsetDateTime.ofInstant(snapshot.observedAt(), ZoneOffset.UTC);
        int accepted = jdbc.update(
            UPSERT_SNAPSHOT,
            corridor,
            observedAt,
            snapshot.sourceZoom(),
            snapshot.status(),
            snapshot.detail(),
            snapshot.cellSizeMiles(),
            snapshot.totalCellCount(),
            snapshot.supportedCellCount(),
            snapshot.uniqueSourcePathCount(),
            snapshot.duplicateSourcePathCount()
        );
        if (accepted == 0) return;

        List<Object[]> cells = snapshot.cells() == null
            ? List.of()
            : snapshot.cells().stream()
                .filter(Objects::nonNull)
                .map(cell -> cellArguments(corridor, observedAt, cell))
                .toList();
        if (!cells.isEmpty()) {
            jdbc.batchUpdate(UPSERT_CELL, cells);
        }
        jdbc.update(DELETE_STALE_CELLS, corridor, observedAt);
    }

    private static Object[] cellArguments(
        String corridor,
        OffsetDateTime observedAt,
        CorridorFlowCellSnapshot.Cell cell
    ) {
        return new Object[]{
            corridor,
            cell.id(),
            observedAt,
            cell.startMileMarker(),
            cell.endMileMarker(),
            cell.direction().name(),
            cell.speedMph(),
            cell.sourcePathCount(),
            cell.oneSideSourceCount(),
            cell.fullSourceCount(),
            cell.unknownCoverageSourceCount(),
            cell.closureEvidence().name(),
            cell.coveredMarkerMiles(),
            cell.finestSourceSpanMiles(),
            cell.lengthWeightedSourceSpanMiles(),
            cell.coarsestSourceSpanMiles(),
            cell.coarsestSourceStartMileMarker(),
            cell.coarsestSourceEndMileMarker(),
            cell.quality().name()
        };
    }
}
