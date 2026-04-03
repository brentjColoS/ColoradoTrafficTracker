package com.example.api_service;

import com.example.api_service.dto.AnomalySampleDto;
import com.example.api_service.dto.TrafficAnomalyResponseDto;
import com.example.api_service.dto.TrafficHistoryResponseDto;
import com.example.api_service.dto.TrafficSampleDto;
import com.example.api_service.dto.TrafficSampleMapper;
import java.time.OffsetDateTime;
import java.util.List;
import org.springframework.cache.annotation.Cacheable;
import org.springframework.data.domain.PageRequest;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/traffic")
public class TrafficController {
    private static final int MAX_WINDOW_MINUTES = 10_080;
    private static final int MAX_HISTORY_LIMIT = 500;
    private static final int MAX_ANOMALY_FETCH_LIMIT = 2_000;

    private final TrafficSampleRepository repo;

    public TrafficController(TrafficSampleRepository repo) {this.repo = repo;}

    @GetMapping("/latest")
    @Cacheable(cacheNames = "apiLatest", key = "#p0", unless = "#result == null || #result.statusCodeValue != 200")
    public ResponseEntity<TrafficSampleDto> latest(@RequestParam("corridor") String corridor) {
        String normalized = normalizeCorridor(corridor);
        if (normalized == null) {
            return ResponseEntity.badRequest().build();
        }

        return repo.findFirstByCorridorOrderByPolledAtDesc(normalized)
            .map(TrafficSampleMapper::toDto)
            .map(ResponseEntity::ok)
            .orElseGet(() -> ResponseEntity.notFound().build());
    }

    @GetMapping("/history")
    @Cacheable(cacheNames = "apiHistory", key = "#p0 + '|' + #p1 + '|' + #p2", unless = "#result == null || #result.statusCodeValue != 200")
    public ResponseEntity<TrafficHistoryResponseDto> history(
        @RequestParam("corridor") String corridor,
        @RequestParam(name = "windowMinutes", defaultValue = "180") int windowMinutes,
        @RequestParam(name = "limit", defaultValue = "120") int limit
    ) {
        String normalized = normalizeCorridor(corridor);
        if (normalized == null) return ResponseEntity.badRequest().build();
        if (windowMinutes < 1 || windowMinutes > MAX_WINDOW_MINUTES) return ResponseEntity.badRequest().build();
        if (limit < 1 || limit > MAX_HISTORY_LIMIT) return ResponseEntity.badRequest().build();

        OffsetDateTime since = OffsetDateTime.now().minusMinutes(windowMinutes);
        List<TrafficSampleDto> samples = repo
            .findByCorridorAndPolledAtGreaterThanEqualOrderByPolledAtDesc(normalized, since, PageRequest.of(0, limit))
            .stream()
            .map(TrafficSampleMapper::toDto)
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
        return repo.findDistinctCorridors();
    }

    @GetMapping("/anomalies")
    @Cacheable(cacheNames = "apiHistory", key = "'anomaly|' + #p0 + '|' + #p1 + '|' + #p2 + '|' + #p3", unless = "#result == null || #result.statusCodeValue != 200")
    public ResponseEntity<TrafficAnomalyResponseDto> anomalies(
        @RequestParam("corridor") String corridor,
        @RequestParam(name = "windowMinutes", defaultValue = "180") int windowMinutes,
        @RequestParam(name = "baselineMinutes", defaultValue = "1440") int baselineMinutes,
        @RequestParam(name = "zThreshold", defaultValue = "2.0") double zThreshold
    ) {
        String normalized = normalizeCorridor(corridor);
        if (normalized == null) return ResponseEntity.badRequest().build();
        if (windowMinutes < 1 || windowMinutes > MAX_WINDOW_MINUTES) return ResponseEntity.badRequest().build();
        if (baselineMinutes <= windowMinutes || baselineMinutes > MAX_WINDOW_MINUTES) return ResponseEntity.badRequest().build();
        if (zThreshold < 0.5 || zThreshold > 5.0) return ResponseEntity.badRequest().build();

        OffsetDateTime now = OffsetDateTime.now();
        OffsetDateTime recentSince = now.minusMinutes(windowMinutes);
        OffsetDateTime baselineSince = now.minusMinutes(baselineMinutes);

        List<TrafficSample> samples = repo
            .findByCorridorAndPolledAtGreaterThanEqualOrderByPolledAtDesc(
                normalized,
                baselineSince,
                PageRequest.of(0, MAX_ANOMALY_FETCH_LIMIT)
            )
            .stream()
            .toList();

        List<Double> baselineSpeeds = samples.stream()
            .filter(s -> s.getPolledAt() != null && s.getPolledAt().isBefore(recentSince))
            .map(TrafficSample::getAvgCurrentSpeed)
            .filter(v -> v != null)
            .toList();

        if (baselineSpeeds.size() < 10) {
            return ResponseEntity.ok(new TrafficAnomalyResponseDto(
                normalized,
                baselineSince,
                windowMinutes,
                baselineMinutes,
                zThreshold,
                baselineSpeeds.size(),
                null,
                null,
                0,
                0,
                List.of(),
                "Not enough baseline samples for anomaly detection"
            ));
        }

        double baselineMean = mean(baselineSpeeds);
        double baselineStd = stdDev(baselineSpeeds, baselineMean);
        double expectedMinSpeed = baselineMean - (zThreshold * baselineStd);

        List<AnomalySampleDto> anomalies = samples.stream()
            .filter(s -> s.getPolledAt() != null && !s.getPolledAt().isBefore(recentSince))
            .filter(s -> s.getAvgCurrentSpeed() != null)
            .filter(s -> baselineStd > 0.0 && s.getAvgCurrentSpeed() < expectedMinSpeed)
            .map(s -> new AnomalySampleDto(
                s.getPolledAt(),
                s.getAvgCurrentSpeed(),
                expectedMinSpeed,
                (baselineMean - s.getAvgCurrentSpeed()) / baselineStd
            ))
            .toList();

        int checkedSamples = (int) samples.stream()
            .filter(s -> s.getPolledAt() != null && !s.getPolledAt().isBefore(recentSince))
            .filter(s -> s.getAvgCurrentSpeed() != null)
            .count();

        return ResponseEntity.ok(new TrafficAnomalyResponseDto(
            normalized,
            baselineSince,
            windowMinutes,
            baselineMinutes,
            zThreshold,
            baselineSpeeds.size(),
            baselineMean,
            baselineStd,
            checkedSamples,
            anomalies.size(),
            anomalies,
            baselineStd <= 0.0 ? "Baseline variance is too small for z-score anomaly detection" : null
        ));
    }

    @GetMapping("/health")
    public String health() {
        return "ok";
    }

    private static double mean(List<Double> values) {
        if (values.isEmpty()) return 0.0;
        double sum = 0.0;
        for (double v : values) sum += v;
        return sum / values.size();
    }

    private static double stdDev(List<Double> values, double mean) {
        if (values.size() < 2) return 0.0;
        double sumSq = 0.0;
        for (double v : values) {
            double delta = v - mean;
            sumSq += delta * delta;
        }
        return Math.sqrt(sumSq / (values.size() - 1));
    }

    private static String normalizeCorridor(String corridor) {
        if (corridor == null || corridor.isBlank()) return null;
        return corridor.trim();
    }
}
