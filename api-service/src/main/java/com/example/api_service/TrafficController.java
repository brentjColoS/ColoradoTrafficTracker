package com.example.api_service;

import com.example.api_service.dto.AnomalySampleDto;
import com.example.api_service.dto.ForecastPointDto;
import com.example.api_service.dto.TrafficAnomalyResponseDto;
import com.example.api_service.dto.TrafficForecastResponseDto;
import com.example.api_service.dto.TrafficHistoryResponseDto;
import com.example.api_service.dto.TrafficSampleDto;
import com.example.api_service.dto.TrafficSampleMapper;
import java.time.OffsetDateTime;
import java.time.temporal.ChronoUnit;
import java.util.Comparator;
import java.util.List;
import org.springframework.cache.annotation.Cacheable;
import org.springframework.data.domain.PageRequest;
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
    private static final int MAX_ANOMALY_FETCH_LIMIT = 2_000;
    private static final int MAX_FORECAST_FETCH_LIMIT = 2_000;

    private final TrafficSampleRepository sampleRepo;
    private final TrafficHistorySampleRepository historyRepo;

    public TrafficController(TrafficSampleRepository sampleRepo, TrafficHistorySampleRepository historyRepo) {
        this.sampleRepo = sampleRepo;
        this.historyRepo = historyRepo;
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

        var latest = preferUsable
            ? sampleRepo.findLatestUsableByCorridor(normalized, PageRequest.of(0, 1)).stream().findFirst()
            : sampleRepo.findFirstByCorridorOrderByPolledAtDesc(normalized);

        if (latest.isEmpty() && preferUsable) {
            latest = sampleRepo.findFirstByCorridorOrderByPolledAtDesc(normalized);
        }

        return latest
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
        List<TrafficSampleDto> samples = historyRepo
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
        return historyRepo.findDistinctCorridors();
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

        List<TrafficHistorySample> samples = historyRepo
            .findByCorridorAndPolledAtGreaterThanEqualOrderByPolledAtDesc(
                normalized,
                baselineSince,
                PageRequest.of(0, MAX_ANOMALY_FETCH_LIMIT)
            )
            .stream()
            .toList();

        List<Double> baselineSpeeds = samples.stream()
            .filter(s -> s.getPolledAt() != null && s.getPolledAt().isBefore(recentSince))
            .map(TrafficHistorySample::getAvgCurrentSpeed)
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
            .filter(s -> s.getPolledAt() != null && s.getAvgCurrentSpeed() != null)
            .sorted(Comparator.comparing(TrafficHistorySample::getPolledAt))
            .toList();

        if (recent.size() < 8) {
            return ResponseEntity.ok(new TrafficForecastResponseDto(
                normalized,
                "local-linear-trend",
                now,
                horizonMinutes,
                stepMinutes,
                recent.size(),
                List.of(),
                "Not enough source samples for forecasting"
            ));
        }

        double[] fit = linearFit(recent);
        double slopePerMinute = fit[0];
        double intercept = fit[1];
        double residualStd = residualStdDev(recent, slopePerMinute, intercept);

        int horizonSteps = Math.max(1, (int) Math.ceil((double) horizonMinutes / stepMinutes));
        long baseMinute = recent.get(0).getPolledAt().toEpochSecond() / 60;

        List<ForecastPointDto> predictions = java.util.stream.IntStream.rangeClosed(1, horizonSteps)
            .mapToObj(step -> {
                OffsetDateTime ts = now.plusMinutes((long) step * stepMinutes);
                long x = (ts.toEpochSecond() / 60) - baseMinute;
                double predicted = clampSpeed((slopePerMinute * x) + intercept);
                double band = Math.max(2.0, residualStd);
                return new ForecastPointDto(
                    ts,
                    predicted,
                    clampSpeed(predicted - band),
                    clampSpeed(predicted + band)
                );
            })
            .toList();

        return ResponseEntity.ok(new TrafficForecastResponseDto(
            normalized,
            "local-linear-trend",
            now,
            horizonMinutes,
            stepMinutes,
            recent.size(),
            predictions,
            null
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

    private static double[] linearFit(List<TrafficHistorySample> samples) {
        long baseMinute = samples.get(0).getPolledAt().toEpochSecond() / 60;
        double sumX = 0.0;
        double sumY = 0.0;
        double sumXY = 0.0;
        double sumXX = 0.0;

        for (TrafficHistorySample sample : samples) {
            double x = (sample.getPolledAt().toEpochSecond() / 60) - baseMinute;
            double y = sample.getAvgCurrentSpeed();
            sumX += x;
            sumY += y;
            sumXY += x * y;
            sumXX += x * x;
        }

        double n = samples.size();
        double denominator = (n * sumXX) - (sumX * sumX);
        if (Math.abs(denominator) < 1e-9) {
            return new double[]{0.0, sumY / n};
        }

        double slope = ((n * sumXY) - (sumX * sumY)) / denominator;
        double intercept = (sumY - (slope * sumX)) / n;
        return new double[]{slope, intercept};
    }

    private static double residualStdDev(List<TrafficHistorySample> samples, double slope, double intercept) {
        if (samples.size() < 3) return 0.0;
        long baseMinute = samples.get(0).getPolledAt().toEpochSecond() / 60;
        double sumSq = 0.0;
        for (TrafficHistorySample sample : samples) {
            double x = (sample.getPolledAt().toEpochSecond() / 60) - baseMinute;
            double predicted = (slope * x) + intercept;
            double delta = sample.getAvgCurrentSpeed() - predicted;
            sumSq += delta * delta;
        }
        return Math.sqrt(sumSq / (samples.size() - 2));
    }

    private static double clampSpeed(double speed) {
        if (speed < 0.0) return 0.0;
        if (speed > 100.0) return 100.0;
        return speed;
    }

    private static String normalizeCorridor(String corridor) {
        if (corridor == null || corridor.isBlank()) return null;
        return corridor.trim();
    }
}
