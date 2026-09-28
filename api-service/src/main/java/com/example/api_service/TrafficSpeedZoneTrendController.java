package com.example.api_service;

import com.example.api_service.dto.TrafficSpeedZoneBaselineDto;
import com.example.api_service.dto.TrafficSpeedZoneBaselineResponseDto;
import com.example.api_service.dto.TrafficSpeedZoneTrendPointDto;
import com.example.api_service.dto.TrafficSpeedZoneTrendResponseDto;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.temporal.ChronoUnit;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import org.springframework.cache.annotation.Cacheable;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping({"/api/traffic/zones", "/dashboard-api/traffic/zones"})
public class TrafficSpeedZoneTrendController {
    private static final Map<Integer, Integer> BUCKET_MINUTES = Map.of(
        2, 1,
        6, 5,
        24, 15,
        168, 60,
        720, 180
    );

    private final TrafficSpeedZoneTrendRepository repository;

    public TrafficSpeedZoneTrendController(TrafficSpeedZoneTrendRepository repository) {
        this.repository = repository;
    }

    @GetMapping("/trends")
    @Cacheable(
        cacheNames = "apiHistory",
        key = "'zone-trends|' + #p0 + '|' + #p1 + '|' + (#p2 == null ? 'now' : #p2)",
        unless = "#result == null || #result.statusCodeValue != 200"
    )
    public ResponseEntity<TrafficSpeedZoneTrendResponseDto> trends(
        @RequestParam("corridor") String corridor,
        @RequestParam("windowHours") int windowHours,
        @RequestParam(name = "asOf", required = false)
        @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME) OffsetDateTime asOf
    ) {
        String normalized = normalizeCorridor(corridor);
        Integer bucketMinutes = BUCKET_MINUTES.get(windowHours);
        if (normalized == null || bucketMinutes == null) return ResponseEntity.badRequest().build();
        if (!repository.isAvailable()) return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE).build();

        Instant windowEnd = asOf == null ? Instant.now() : asOf.toInstant();
        Instant windowStart = windowEnd.minus(windowHours, ChronoUnit.HOURS);
        List<TrafficSpeedZoneTrendRepository.TrendPoint> rows = repository.find(
            normalized,
            windowStart,
            windowEnd,
            bucketMinutes
        );
        if (rows.isEmpty()) return ResponseEntity.notFound().build();

        Instant firstObservedAt = rows.stream()
            .map(TrafficSpeedZoneTrendRepository.TrendPoint::bucketStart)
            .min(Instant::compareTo)
            .orElse(null);
        Instant lastObservedAt = rows.stream()
            .map(TrafficSpeedZoneTrendRepository.TrendPoint::bucketStart)
            .max(Instant::compareTo)
            .orElse(null);
        int availableBucketCount = (int) rows.stream()
            .map(TrafficSpeedZoneTrendRepository.TrendPoint::bucketStart)
            .distinct()
            .count();

        return ResponseEntity.ok(new TrafficSpeedZoneTrendResponseDto(
            normalized,
            windowStart,
            windowEnd,
            windowHours,
            bucketMinutes,
            rows.size(),
            availableBucketCount,
            firstObservedAt,
            lastObservedAt,
            rows.stream().map(TrafficSpeedZoneTrendController::toDto).toList()
        ));
    }

    @GetMapping("/baselines")
    @Cacheable(
        cacheNames = "apiBaselines",
        key = "'weekly-zone-baseline|' + #p0.trim().toUpperCase() + '|' + T(com.example.api_service.TrafficBaselineSupport).denverWeekStart(#p1)",
        unless = "#result == null || #result.statusCodeValue != 200"
    )
    public ResponseEntity<TrafficSpeedZoneBaselineResponseDto> baselines(
        @RequestParam("corridor") String corridor,
        @RequestParam(name = "asOf", required = false)
        @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME) OffsetDateTime asOf
    ) {
        String normalized = normalizeCorridor(corridor);
        if (normalized == null) return ResponseEntity.badRequest().build();
        if (!repository.isAvailable()) return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE).build();

        OffsetDateTime weekStart = TrafficBaselineSupport.denverWeekStart(asOf);
        OffsetDateTime historySince = weekStart.minusWeeks(TrafficBaselineSupport.LOOKBACK_WEEKS);
        Map<String, List<TrafficSpeedZoneTrendRepository.BaselinePoint>> rowsByZone = repository
            .findBaselineHistory(normalized, historySince.toInstant(), weekStart.toInstant())
            .stream()
            .filter(row -> row.bucketStart() != null && row.avgCurrentSpeed() != null)
            .collect(java.util.stream.Collectors.groupingBy(
                TrafficSpeedZoneTrendRepository.BaselinePoint::zoneKey,
                LinkedHashMap::new,
                java.util.stream.Collectors.toList()
            ));
        List<TrafficSpeedZoneBaselineDto> zones = rowsByZone.values().stream().map(rows -> {
            TrafficSpeedZoneTrendRepository.BaselinePoint latest = rows.get(rows.size() - 1);
            var profiles = TrafficBaselineSupport.buildProfiles(
                rows.stream()
                    .map(row -> new TrafficBaselineSupport.Observation(row.bucketStart(), row.avgCurrentSpeed()))
                    .toList(),
                weekStart
            );
            return new TrafficSpeedZoneBaselineDto(
                latest.zoneKey(),
                latest.zoneOrder(),
                latest.zoneLabel(),
                latest.startMileMarker(),
                latest.endMileMarker(),
                latest.postedSpeedMph(),
                profiles.size(),
                profiles
            );
        }).toList();

        return ResponseEntity.ok(new TrafficSpeedZoneBaselineResponseDto(
            normalized,
            weekStart,
            historySince,
            TrafficBaselineSupport.LOOKBACK_WEEKS,
            TrafficBaselineSupport.RECENCY_HALF_LIFE_WEEKS,
            zones.size(),
            zones
        ));
    }

    private static TrafficSpeedZoneTrendPointDto toDto(TrafficSpeedZoneTrendRepository.TrendPoint row) {
        return new TrafficSpeedZoneTrendPointDto(
            row.zoneKey(),
            row.zoneOrder(),
            row.zoneLabel(),
            row.zoneDescription(),
            row.startMileMarker(),
            row.endMileMarker(),
            row.postedSpeedMph(),
            row.bucketStart(),
            row.avgCurrentSpeed(),
            row.minCurrentSpeed(),
            row.observationCount()
        );
    }

    private static String normalizeCorridor(String corridor) {
        if (corridor == null) return null;
        String value = corridor.trim().toUpperCase(Locale.ROOT);
        return "I25".equals(value) || "I70".equals(value) ? value : null;
    }
}
