package com.example.api_service;

import com.example.api_service.dto.CorridorAnalyticsSummaryDto;
import com.example.api_service.dto.CorridorTrendPointDto;
import com.example.api_service.dto.IncidentHotspotDto;
import com.example.api_service.dto.TrafficAnalyticsSummaryResponseDto;
import com.example.api_service.dto.TrafficHotspotResponseDto;
import com.example.api_service.dto.TrafficTrendResponseDto;
import java.time.OffsetDateTime;
import java.util.Comparator;
import java.util.List;
import java.util.Locale;
import org.springframework.cache.annotation.Cacheable;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/traffic/analytics")
public class TrafficAnalyticsController {
    private static final int MAX_WINDOW_HOURS = 8_760;
    private static final int MAX_LIMIT = 1_000;

    private final TrafficAnalyticsRepository analyticsRepository;

    public TrafficAnalyticsController(TrafficAnalyticsRepository analyticsRepository) {
        this.analyticsRepository = analyticsRepository;
    }

    @GetMapping("/corridors")
    @Cacheable(
        cacheNames = "apiHistory",
        key = "'analytics-corridors|' + #p0",
        unless = "#result == null || #result.statusCodeValue != 200"
    )
    public ResponseEntity<TrafficAnalyticsSummaryResponseDto> corridors(
        @RequestParam(name = "windowHours", defaultValue = "168") int windowHours
    ) {
        if (windowHours < 1 || windowHours > MAX_WINDOW_HOURS) return ResponseEntity.badRequest().build();

        OffsetDateTime since = OffsetDateTime.now().minusHours(windowHours);
        List<CorridorAnalyticsSummaryDto> corridors = analyticsRepository.summarizeCorridors(since).stream()
            .map(row -> new CorridorAnalyticsSummaryDto(
                row.getCorridor(),
                row.getBucketCount(),
                row.getSampleCount(),
                row.getAvgCurrentSpeed(),
                row.getMinCurrentSpeed(),
                row.getAvgSpeedStddev(),
                row.getTotalIncidentCount(),
                row.getFirstBucketStart(),
                row.getLastBucketStart()
            ))
            .toList();

        return ResponseEntity.ok(new TrafficAnalyticsSummaryResponseDto(
            since,
            windowHours,
            corridors.size(),
            corridors
        ));
    }

    @GetMapping("/trends")
    @Cacheable(
        cacheNames = "apiHistory",
        key = "'analytics-trends|' + #p0 + '|' + #p1 + '|' + #p2",
        unless = "#result == null || #result.statusCodeValue != 200"
    )
    public ResponseEntity<TrafficTrendResponseDto> trends(
        @RequestParam("corridor") String corridor,
        @RequestParam(name = "windowHours", defaultValue = "168") int windowHours,
        @RequestParam(name = "limit", defaultValue = "168") int limit
    ) {
        String normalized = normalizeCorridor(corridor);
        if (normalized == null) return ResponseEntity.badRequest().build();
        if (windowHours < 1 || windowHours > MAX_WINDOW_HOURS) return ResponseEntity.badRequest().build();
        if (limit < 1 || limit > MAX_LIMIT) return ResponseEntity.badRequest().build();

        OffsetDateTime since = OffsetDateTime.now().minusHours(windowHours);
        List<CorridorTrendPointDto> buckets = analyticsRepository.findTrend(normalized, since, limit).stream()
            .map(row -> new CorridorTrendPointDto(
                row.getBucketStart(),
                row.getSampleCount(),
                row.getAvgCurrentSpeed(),
                row.getAvgFreeflowSpeed(),
                row.getMinCurrentSpeed(),
                row.getAvgConfidence(),
                row.getAvgSpeedStddev(),
                row.getAvgP50Speed(),
                row.getAvgP90Speed(),
                row.getTotalIncidents(),
                row.getArchivedSampleCount()
            ))
            .sorted(Comparator.comparing(CorridorTrendPointDto::bucketStart))
            .toList();

        return ResponseEntity.ok(new TrafficTrendResponseDto(
            normalized,
            since,
            windowHours,
            buckets.size(),
            buckets
        ));
    }

    @GetMapping("/hotspots")
    @Cacheable(
        cacheNames = "apiHistory",
        key = "'analytics-hotspots|' + (#p0 == null ? 'all' : #p0) + '|' + #p1 + '|' + #p2",
        unless = "#result == null || #result.statusCodeValue != 200"
    )
    public ResponseEntity<TrafficHotspotResponseDto> hotspots(
        @RequestParam(name = "corridor", required = false) String corridor,
        @RequestParam(name = "windowHours", defaultValue = "168") int windowHours,
        @RequestParam(name = "limit", defaultValue = "20") int limit
    ) {
        String normalized = corridor == null || corridor.isBlank() ? null : normalizeCorridor(corridor);
        if (corridor != null && normalized == null) return ResponseEntity.badRequest().build();
        if (windowHours < 1 || windowHours > MAX_WINDOW_HOURS) return ResponseEntity.badRequest().build();
        if (limit < 1 || limit > MAX_LIMIT) return ResponseEntity.badRequest().build();

        OffsetDateTime since = OffsetDateTime.now().minusHours(windowHours);
        List<TrafficIncidentHotspotProjection> rows = normalized == null
            ? analyticsRepository.findHotspots(since, limit)
            : analyticsRepository.findHotspotsByCorridor(normalized, since, limit);

        List<IncidentHotspotDto> hotspots = rows.stream()
            .map(row -> new IncidentHotspotDto(
                row.getCorridor(),
                row.getTravelDirection(),
                directionLabel(row.getTravelDirection()),
                row.getMileMarkerBand(),
                referenceLabel(row.getCorridor(), row.getTravelDirection(), row.getMileMarkerBand()),
                row.getIncidentCount(),
                row.getAvgDelaySeconds(),
                row.getMaxDelaySeconds(),
                row.getArchivedIncidentCount(),
                row.getFirstSeenAt(),
                row.getLastSeenAt()
            ))
            .toList();

        return ResponseEntity.ok(new TrafficHotspotResponseDto(
            normalized,
            since,
            windowHours,
            hotspots.size(),
            hotspots
        ));
    }

    private static String normalizeCorridor(String corridor) {
        if (corridor == null) return null;
        String value = corridor.trim().toUpperCase(Locale.ROOT);
        return value.isBlank() ? null : value;
    }

    private static String directionLabel(String direction) {
        String normalized = normalizeDirection(direction);
        if (normalized == null) return null;
        return switch (normalized) {
            case "N" -> "northbound";
            case "S" -> "southbound";
            case "E" -> "eastbound";
            case "W" -> "westbound";
            default -> null;
        };
    }

    private static String normalizeDirection(String direction) {
        if (direction == null || direction.isBlank()) return null;
        return direction.trim().toUpperCase(Locale.ROOT);
    }

    private static String referenceLabel(String corridor, String direction, Integer mileMarkerBand) {
        String directionLabel = directionLabel(direction);
        if (mileMarkerBand != null && directionLabel != null) {
            return String.format(Locale.US, "%s %s near MM %d", corridor, directionLabel, mileMarkerBand);
        }
        if (mileMarkerBand != null) {
            return String.format(Locale.US, "%s near MM %d", corridor, mileMarkerBand);
        }
        if (directionLabel != null) {
            return corridor + " " + directionLabel;
        }
        return corridor;
    }
}
