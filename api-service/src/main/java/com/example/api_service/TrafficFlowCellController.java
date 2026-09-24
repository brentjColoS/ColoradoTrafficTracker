package com.example.api_service;

import com.example.api_service.dto.CurrentTrafficFlowCellResponseDto;
import com.example.api_service.dto.HourlyTrafficFlowCellResponseDto;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import org.springframework.cache.annotation.Cacheable;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping({"/api/traffic/map/flow-cells", "/dashboard-api/traffic/map/flow-cells"})
public class TrafficFlowCellController {
    private static final Set<String> CORRIDORS = Set.of("I25", "I70");

    private final TrafficFlowCellReadRepository repository;

    public TrafficFlowCellController(TrafficFlowCellReadRepository repository) {
        this.repository = repository;
    }

    @GetMapping("/current")
    @Cacheable(
        cacheNames = "apiLatest",
        key = "'flow-cells-current|' + #p0",
        unless = "#result == null || #result.statusCodeValue != 200"
    )
    public ResponseEntity<CurrentTrafficFlowCellResponseDto> current(
        @RequestParam("corridor") String corridor
    ) {
        String normalized = normalizeCorridor(corridor);
        if (normalized == null) return ResponseEntity.badRequest().build();

        CurrentFlowCellSnapshotProjection snapshot = repository.findCurrentSnapshot(normalized)
            .stream()
            .findFirst()
            .orElse(null);
        if (snapshot == null) return ResponseEntity.notFound().build();

        List<CurrentTrafficFlowCellResponseDto.Cell> cells = repository.findCurrentCells(normalized)
            .stream()
            .map(TrafficFlowCellController::toCurrentCell)
            .toList();
        return ResponseEntity.ok(new CurrentTrafficFlowCellResponseDto(
            snapshot.getCorridor(),
            snapshot.getObservedAt(),
            snapshot.getSourceZoom(),
            snapshot.getStatus(),
            snapshot.getDetail(),
            snapshot.getCellSizeMiles(),
            snapshot.getTotalCellCount(),
            snapshot.getSupportedCellCount(),
            snapshot.getUniqueSourcePathCount(),
            snapshot.getDuplicateSourcePathCount(),
            cells
        ));
    }

    @GetMapping("/hourly")
    @Cacheable(
        cacheNames = "apiHistory",
        key = "'flow-cells-hourly|' + #p0 + '|' + #p1",
        unless = "#result == null || #result.statusCodeValue != 200"
    )
    public ResponseEntity<HourlyTrafficFlowCellResponseDto> hourly(
        @RequestParam("corridor") String corridor,
        @RequestParam("asOf")
        @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME) OffsetDateTime asOf
    ) {
        String normalized = normalizeCorridor(corridor);
        if (normalized == null || asOf == null) return ResponseEntity.badRequest().build();

        OffsetDateTime hourStart = asOf.withOffsetSameInstant(ZoneOffset.UTC)
            .truncatedTo(ChronoUnit.HOURS);
        List<HourlyTrafficFlowCellResponseDto.Cell> cells = repository
            .findHourlyCells(normalized, hourStart)
            .stream()
            .map(TrafficFlowCellController::toHourlyCell)
            .toList();
        if (cells.isEmpty()) return ResponseEntity.notFound().build();

        return ResponseEntity.ok(new HourlyTrafficFlowCellResponseDto(
            normalized,
            hourStart.toInstant(),
            hourStart.plusHours(1).toInstant(),
            "HOURLY",
            cells
        ));
    }

    private static CurrentTrafficFlowCellResponseDto.Cell toCurrentCell(
        CurrentFlowCellProjection cell
    ) {
        return new CurrentTrafficFlowCellResponseDto.Cell(
            cell.getCellId(),
            cell.getObservedAt(),
            cell.getStartMileMarker(),
            cell.getEndMileMarker(),
            cell.getDirection(),
            cell.getSpeedMph(),
            cell.getSourcePathCount(),
            cell.getOneSideSourceCount(),
            cell.getFullSourceCount(),
            cell.getUnknownCoverageSourceCount(),
            cell.getClosureEvidence(),
            cell.getCoveredMarkerMiles(),
            cell.getFinestSourceSpanMiles(),
            cell.getLengthWeightedSourceSpanMiles(),
            cell.getCoarsestSourceSpanMiles(),
            cell.getCoarsestSourceStartMileMarker(),
            cell.getCoarsestSourceEndMileMarker(),
            cell.getQuality()
        );
    }

    private static HourlyTrafficFlowCellResponseDto.Cell toHourlyCell(
        HourlyFlowCellProjection cell
    ) {
        return new HourlyTrafficFlowCellResponseDto.Cell(
            cell.getCellId(),
            cell.getDirection(),
            cell.getStartMileMarker(),
            cell.getEndMileMarker(),
            cell.getSourceZoomMin(),
            cell.getSourceZoomMax(),
            cell.getObservationCount(),
            cell.getAvgSpeedMph(),
            cell.getMinSpeedMph(),
            cell.getMaxSpeedMph(),
            cell.getFullCellObservationCount(),
            cell.getPartialCellObservationCount(),
            cell.getClosureObservationCount(),
            cell.getMinFinestSourceSpanMiles(),
            cell.getAvgLengthWeightedSourceSpanMiles(),
            cell.getMaxCoarsestSourceSpanMiles(),
            cell.getFirstObservedAt(),
            cell.getLastObservedAt()
        );
    }

    private static String normalizeCorridor(String corridor) {
        if (corridor == null) return null;
        String normalized = corridor.trim().toUpperCase(Locale.ROOT);
        return CORRIDORS.contains(normalized) ? normalized : null;
    }
}
