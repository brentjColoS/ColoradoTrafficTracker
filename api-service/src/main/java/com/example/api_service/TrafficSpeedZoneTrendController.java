package com.example.api_service;

import com.example.api_service.dto.TrafficSpeedZoneTrendPointDto;
import com.example.api_service.dto.TrafficSpeedZoneTrendResponseDto;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.temporal.ChronoUnit;
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
