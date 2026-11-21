package com.example.api_service;

import com.example.api_service.dto.TrafficAnomalyResponseDto;
import com.example.api_service.dto.TrafficForecastResponseDto;
import com.example.api_service.dto.TrafficHistoryResponseDto;
import com.example.api_service.dto.TrafficSampleDto;
import com.example.api_service.dto.TrafficSampleMapper;
import com.example.api_service.dto.TrafficSpeedZoneHistoryResponseDto;
import com.example.api_service.dto.TrafficSpeedZoneSampleDto;
import java.time.OffsetDateTime;
import java.time.temporal.ChronoUnit;
import java.util.List;
import org.springframework.cache.annotation.Cacheable;
import org.springframework.data.domain.PageRequest;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping({"/api/traffic", "/dashboard-api/traffic"})
public class TrafficController {
    private static final int MAX_WINDOW_MINUTES = 10_080;
    private static final int MAX_HISTORY_LIMIT = 500;
    private static final int MAX_SPEED_ONLY_HISTORY_LIMIT = 2_000;
    private static final int MAX_ANOMALY_FETCH_LIMIT = 2_000;
    private static final int MAX_FORECAST_FETCH_LIMIT = 2_000;
    private static final String DEFAULT_MINIMUM_DROP_MPH = "3.0";
    private static final String DEFAULT_SLOWDOWN_GROUP_GAP_MINUTES = "3";

    private final TrafficSampleRepository sampleRepo;
    private final TrafficHistorySampleRepository historyRepo;
    private final TrafficSpeedZoneSampleRepository zoneSampleRepo;

    public TrafficController(
        TrafficSampleRepository sampleRepo,
        TrafficHistorySampleRepository historyRepo,
        TrafficSpeedZoneSampleRepository zoneSampleRepo
    ) {
        this.sampleRepo = sampleRepo;
        this.historyRepo = historyRepo;
        this.zoneSampleRepo = zoneSampleRepo;
    }

    @GetMapping("/latest")
    @Cacheable(cacheNames = "apiLatest", key = "#p0 + '|' + #p1", unless = "#result == null || #result.statusCodeValue != 200")
    public ResponseEntity<TrafficSampleDto> latest(
        @RequestParam("corridor") String corridor,
        @RequestParam(name = "preferUsable", defaultValue = "false") boolean preferUsable
    ) {
        String normalized = normalizeCorridor(corridor);
        if (normalized == null) {
            return ResponseEntity.badRequest().build();
        }

        var latest = LatestTrafficSamples.find(sampleRepo, normalized, preferUsable);

        return latest
            .map(TrafficSampleMapper::toDto)
            .map(ResponseEntity::ok)
            .orElseGet(() -> ResponseEntity.notFound().build());
    }

    @GetMapping("/history")
    @Cacheable(cacheNames = "apiHistory", key = "#p0 + '|' + #p1 + '|' + #p2 + '|' + #p3 + '|' + #p4 + '|' + (#p5 == null ? 'now' : #p5)", unless = "#result == null || #result.statusCodeValue != 200")
    public ResponseEntity<TrafficHistoryResponseDto> history(
        @RequestParam("corridor") String corridor,
        @RequestParam(name = "windowMinutes", defaultValue = "180") int windowMinutes,
        @RequestParam(name = "limit", defaultValue = "120") int limit,
        @RequestParam(name = "preferUsable", defaultValue = "false") boolean preferUsable,
        @RequestParam(name = "includeIncidents", defaultValue = "true") boolean includeIncidents,
        @RequestParam(name = "asOf", required = false)
        @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME) OffsetDateTime asOf
    ) {
        String normalized = normalizeCorridor(corridor);
        if (normalized == null) return ResponseEntity.badRequest().build();
        if (windowMinutes < 1 || windowMinutes > MAX_WINDOW_MINUTES) return ResponseEntity.badRequest().build();
        int maximumLimit = includeIncidents ? MAX_HISTORY_LIMIT : MAX_SPEED_ONLY_HISTORY_LIMIT;
        if (limit < 1 || limit > maximumLimit) return ResponseEntity.badRequest().build();

        OffsetDateTime until = asOf == null ? OffsetDateTime.now() : asOf;
        OffsetDateTime since = until.minusMinutes(windowMinutes);
        List<TrafficSampleDto> samples = (asOf == null
            ? (preferUsable
                ? historyRepo.findUsableByCorridorAndPolledAtGreaterThanEqualOrderByPolledAtDesc(normalized, since, PageRequest.of(0, limit))
                : historyRepo.findByCorridorAndPolledAtGreaterThanEqualOrderByPolledAtDesc(normalized, since, PageRequest.of(0, limit)))
            : (preferUsable
                ? historyRepo.findUsableByCorridorAndPolledAtBetweenOrderByPolledAtDesc(normalized, since, until, PageRequest.of(0, limit))
                : historyRepo.findByCorridorAndPolledAtBetweenOrderByPolledAtDesc(normalized, since, until, PageRequest.of(0, limit))))
            .stream()
            .map(sample -> TrafficSampleMapper.toDto(sample, includeIncidents))
            .toList();

        return ResponseEntity.ok(
            new TrafficHistoryResponseDto(
                normalized,
                since,
                windowMinutes,
                limit,
                samples.size(),
                samples
            )
        );
    }

    @GetMapping("/corridors")
    @Cacheable(cacheNames = "apiCorridors")
    public List<String> corridors() {
        return historyRepo.findDistinctCorridors();
    }

    @GetMapping("/zones/history")
    @Cacheable(cacheNames = "apiHistory", key = "'zone-history|' + #p0 + '|' + #p1 + '|' + #p2 + '|' + (#p3 == null ? 'now' : #p3)", unless = "#result == null || #result.statusCodeValue != 200")
    public ResponseEntity<TrafficSpeedZoneHistoryResponseDto> zoneHistory(
        @RequestParam("corridor") String corridor,
        @RequestParam(name = "windowMinutes", defaultValue = "180") int windowMinutes,
        @RequestParam(name = "limit", defaultValue = "240") int limit,
        @RequestParam(name = "asOf", required = false)
        @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME) OffsetDateTime asOf
    ) {
        String normalized = normalizeCorridor(corridor);
        if (normalized == null) return ResponseEntity.badRequest().build();
        if (windowMinutes < 1 || windowMinutes > MAX_WINDOW_MINUTES) return ResponseEntity.badRequest().build();
        if (limit < 1 || limit > 1_000) return ResponseEntity.badRequest().build();

        OffsetDateTime until = asOf == null ? OffsetDateTime.now() : asOf;
        OffsetDateTime since = until.minusMinutes(windowMinutes);
        List<TrafficSpeedZoneSample> zoneRows = asOf == null
            ? zoneSampleRepo.findByCorridorAndPolledAtGreaterThanEqualOrderByPolledAtDescZoneOrderAsc(
                normalized, since, PageRequest.of(0, limit + 1))
            : zoneSampleRepo.findByCorridorAndPolledAtBetweenOrderByPolledAtDescZoneOrderAsc(
                normalized, since, until, PageRequest.of(0, limit + 1));
        List<TrafficSpeedZoneSampleDto> rows = zoneRows
            .stream()
            .map(TrafficController::toZoneDto)
            .toList();
        boolean truncated = rows.size() > limit;
        List<TrafficSpeedZoneSampleDto> samples = rows.stream().limit(limit).toList();
        int returnedSnapshots = (int) samples.stream()
            .map(TrafficSpeedZoneSampleDto::sampleId)
            .filter(java.util.Objects::nonNull)
            .distinct()
            .count();

        return ResponseEntity.ok(new TrafficSpeedZoneHistoryResponseDto(
            normalized,
            since,
            windowMinutes,
            limit,
            samples.size(),
            returnedSnapshots,
            truncated,
            samples.size(),
            samples
        ));
    }

    @GetMapping("/anomalies")
    @Cacheable(cacheNames = "apiHistory", key = "'anomaly|' + #p0 + '|' + #p1 + '|' + #p2 + '|' + #p3 + '|' + #p4 + '|' + #p5", unless = "#result == null || #result.statusCodeValue != 200")
    public ResponseEntity<TrafficAnomalyResponseDto> anomalies(
        @RequestParam("corridor") String corridor,
        @RequestParam(name = "windowMinutes", defaultValue = "180") int windowMinutes,
        @RequestParam(name = "baselineMinutes", defaultValue = "1440") int baselineMinutes,
        @RequestParam(name = "zThreshold", defaultValue = "2.0") double zThreshold,
        @RequestParam(name = "minimumDropMph", defaultValue = DEFAULT_MINIMUM_DROP_MPH) double minimumDropMph,
        @RequestParam(name = "groupGapMinutes", defaultValue = DEFAULT_SLOWDOWN_GROUP_GAP_MINUTES) int groupGapMinutes
    ) {
        String normalized = normalizeCorridor(corridor);
        if (normalized == null) return ResponseEntity.badRequest().build();
        if (windowMinutes < 1 || windowMinutes > MAX_WINDOW_MINUTES) return ResponseEntity.badRequest().build();
        if (baselineMinutes <= windowMinutes || baselineMinutes > MAX_WINDOW_MINUTES) return ResponseEntity.badRequest().build();
        if (zThreshold < 0.5 || zThreshold > 5.0) return ResponseEntity.badRequest().build();
        if (minimumDropMph < 0.0 || minimumDropMph > 30.0) return ResponseEntity.badRequest().build();
        if (groupGapMinutes < 1 || groupGapMinutes > 60) return ResponseEntity.badRequest().build();

        OffsetDateTime now = OffsetDateTime.now();
        OffsetDateTime recentSince = now.minusMinutes(windowMinutes);
        OffsetDateTime baselineSince = now.minusMinutes(baselineMinutes);

        List<TrafficHistorySample> samples = historyRepo
            .findByCorridorAndPolledAtGreaterThanEqualOrderByPolledAtDesc(
                normalized,
                baselineSince,
                PageRequest.of(0, MAX_ANOMALY_FETCH_LIMIT)
            )
            .stream()
            .toList();

        var assessment = TrafficAnomalyAnalysis.analyze(normalized, samples, recentSince,
            new TrafficAnomalyAnalysis.Thresholds(zThreshold, minimumDropMph, groupGapMinutes));
        return ResponseEntity.ok(new TrafficAnomalyResponseDto(
            normalized,
            baselineSince,
            windowMinutes,
            baselineMinutes,
            zThreshold,
            minimumDropMph,
            groupGapMinutes,
            assessment.baselineSampleCount(),
            assessment.baselineMean(),
            assessment.baselineStd(),
            assessment.checkedSamples(),
            assessment.anomalies().size(),
            assessment.anomalies().size(),
            assessment.slowdownEvents().size(),
            assessment.anomalies(),
            assessment.slowdownEvents(),
            assessment.note()
        ));
    }

    @GetMapping("/forecast")
    @Cacheable(cacheNames = "apiHistory", key = "'forecast|' + #p0 + '|' + #p1 + '|' + #p2 + '|' + #p3", unless = "#result == null || #result.statusCodeValue != 200")
    public ResponseEntity<TrafficForecastResponseDto> forecast(
        @RequestParam("corridor") String corridor,
        @RequestParam(name = "horizonMinutes", defaultValue = "60") int horizonMinutes,
        @RequestParam(name = "windowMinutes", defaultValue = "720") int windowMinutes,
        @RequestParam(name = "stepMinutes", defaultValue = "15") int stepMinutes
    ) {
        String normalized = normalizeCorridor(corridor);
        if (normalized == null) return ResponseEntity.badRequest().build();
        if (windowMinutes < 60 || windowMinutes > MAX_WINDOW_MINUTES) return ResponseEntity.badRequest().build();
        if (horizonMinutes < 15 || horizonMinutes > 360) return ResponseEntity.badRequest().build();
        if (stepMinutes < 5 || stepMinutes > 60) return ResponseEntity.badRequest().build();

        OffsetDateTime now = OffsetDateTime.now().truncatedTo(ChronoUnit.MINUTES);
        OffsetDateTime since = now.minusMinutes(windowMinutes);
        List<TrafficHistorySample> recent = historyRepo
            .findByCorridorAndPolledAtGreaterThanEqualOrderByPolledAtDesc(
                normalized,
                since,
                PageRequest.of(0, MAX_FORECAST_FETCH_LIMIT)
            )
            .stream()
            .toList();
        var forecast = TrafficForecast.predict(recent, now, horizonMinutes, stepMinutes);
        return ResponseEntity.ok(new TrafficForecastResponseDto(
            normalized,
            "local-linear-trend",
            now,
            horizonMinutes,
            stepMinutes,
            forecast.sourceSamples(),
            forecast.predictions(),
            forecast.note()
        ));
    }

    @GetMapping("/health")
    public String health() {
        return "ok";
    }

    private static TrafficSpeedZoneSampleDto toZoneDto(TrafficSpeedZoneSample sample) {
        return new TrafficSpeedZoneSampleDto(
            sample.getId(),
            sample.getSampleId(),
            sample.getCorridor(),
            sample.getZoneKey(),
            sample.getZoneOrder(),
            sample.getZoneLabel(),
            sample.getZoneDescription(),
            sample.getStartMileMarker(),
            sample.getEndMileMarker(),
            sample.getPostedSpeedMph(),
            sample.getAvgCurrentSpeed(),
            sample.getMinCurrentSpeed(),
            sample.getSpeedStddev(),
            sample.getP10Speed(),
            sample.getP50Speed(),
            sample.getP90Speed(),
            sample.getSpeedSampleCount(),
            sample.getSpeedStateSignature(),
            sample.getPolledAt()
        );
    }

    private static String normalizeCorridor(String corridor) {
        if (corridor == null || corridor.isBlank()) return null;
        return corridor.trim().toUpperCase();
    }
}
