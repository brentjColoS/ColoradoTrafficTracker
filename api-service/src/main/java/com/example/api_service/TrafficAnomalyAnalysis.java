package com.example.api_service;

import com.example.api_service.dto.AnomalySampleDto;
import com.example.api_service.dto.TrafficSlowdownEventDto;
import java.time.OffsetDateTime;
import java.time.format.DateTimeFormatter;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;

final class TrafficAnomalyAnalysis {
    private static final DateTimeFormatter SLOWDOWN_ID_TIME_FORMAT = DateTimeFormatter.ofPattern("yyyyMMdd-HHmm");

    private TrafficAnomalyAnalysis() {}

    static Assessment analyze(String corridor, List<TrafficHistorySample> samples,
                              OffsetDateTime recentSince, Thresholds thresholds) {
        List<Double> baselineSpeeds = samples.stream()
            .filter(s -> s.getPolledAt() != null && s.getPolledAt().isBefore(recentSince))
            .map(TrafficHistorySample::getAvgCurrentSpeed)
            .filter(v -> v != null)
            .toList();

        if (baselineSpeeds.size() < 10) {
            return new Assessment(baselineSpeeds.size(), null, null, 0, List.of(), List.of(),
                "Not enough baseline samples for anomaly detection");
        }

        double baselineMean = mean(baselineSpeeds);
        double baselineStd = stdDev(baselineSpeeds, baselineMean);
        double expectedMinSpeed = baselineMean - (thresholds.zScore() * baselineStd);

        List<AnomalySampleDto> anomalies = samples.stream()
            .filter(s -> s.getPolledAt() != null && !s.getPolledAt().isBefore(recentSince))
            .filter(s -> s.getAvgCurrentSpeed() != null)
            .filter(s -> baselineStd > 0.0 && s.getAvgCurrentSpeed() < expectedMinSpeed)
            .filter(s -> baselineMean - s.getAvgCurrentSpeed() >= thresholds.minimumDropMph())
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

        List<TrafficSlowdownEventDto> slowdownEvents = buildSlowdownEvents(
            corridor,
            anomalies,
            baselineMean,
            thresholds.groupGapMinutes()
        );

        return new Assessment(baselineSpeeds.size(), baselineMean, baselineStd, checkedSamples,
            anomalies, slowdownEvents,
            baselineStd <= 0.0 ? "Baseline variance is too small for z-score anomaly detection" : null);
    }

    record Thresholds(double zScore, double minimumDropMph, int groupGapMinutes) {}
    record Assessment(int baselineSampleCount, Double baselineMean, Double baselineStd,
                      int checkedSamples, List<AnomalySampleDto> anomalies,
                      List<TrafficSlowdownEventDto> slowdownEvents, String note) {}

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

    private static List<TrafficSlowdownEventDto> buildSlowdownEvents(
        String corridor,
        List<AnomalySampleDto> anomalies,
        double baselineMean,
        int groupGapMinutes
    ) {
        if (anomalies.isEmpty()) {
            return List.of();
        }

        List<AnomalySampleDto> chronological = anomalies.stream()
            .sorted(Comparator.comparing(AnomalySampleDto::polledAt))
            .toList();

        List<List<AnomalySampleDto>> groups = new ArrayList<>();
        List<AnomalySampleDto> currentGroup = new ArrayList<>();

        for (AnomalySampleDto sample : chronological) {
            if (!currentGroup.isEmpty()) {
                AnomalySampleDto previous = currentGroup.get(currentGroup.size() - 1);
                long gapMinutes = ChronoUnit.MINUTES.between(previous.polledAt(), sample.polledAt());
                if (gapMinutes > groupGapMinutes) {
                    groups.add(currentGroup);
                    currentGroup = new ArrayList<>();
                }
            }
            currentGroup.add(sample);
        }

        if (!currentGroup.isEmpty()) {
            groups.add(currentGroup);
        }

        List<TrafficSlowdownEventDto> events = new ArrayList<>();
        for (int i = 0; i < groups.size(); i++) {
            events.add(toSlowdownEvent(corridor, groups.get(i), baselineMean, i + 1));
        }
        return events;
    }

    private static TrafficSlowdownEventDto toSlowdownEvent(
        String corridor,
        List<AnomalySampleDto> samples,
        double baselineMean,
        int sequence
    ) {
        OffsetDateTime startedAt = samples.get(0).polledAt();
        OffsetDateTime endedAt = samples.get(samples.size() - 1).polledAt();
        double minimumObservedSpeed = samples.stream()
            .mapToDouble(AnomalySampleDto::observedSpeed)
            .min()
            .orElse(0.0);
        double averageObservedSpeed = samples.stream()
            .mapToDouble(AnomalySampleDto::observedSpeed)
            .average()
            .orElse(0.0);
        double strongestZScore = samples.stream()
            .mapToDouble(AnomalySampleDto::zScore)
            .max()
            .orElse(0.0);

        String eventId = "Slowdown-%s-%s-%03d".formatted(
            corridor,
            startedAt.truncatedTo(ChronoUnit.MINUTES).format(SLOWDOWN_ID_TIME_FORMAT),
            sequence
        );

        return new TrafficSlowdownEventDto(
            eventId,
            "%s slowdown starting %s".formatted(corridor, startedAt.truncatedTo(ChronoUnit.MINUTES)),
            corridor,
            startedAt,
            endedAt,
            ChronoUnit.MINUTES.between(startedAt, endedAt),
            samples.size(),
            minimumObservedSpeed,
            averageObservedSpeed,
            baselineMean - minimumObservedSpeed,
            strongestZScore
        );
    }

}
