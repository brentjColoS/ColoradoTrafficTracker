package com.example.api_service;

import com.example.api_service.dto.TrafficSampleDto;
import com.example.api_service.dto.TrafficStagnationAssessmentDto;
import java.time.Duration;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import org.springframework.data.domain.PageRequest;

final class TrafficStagnation {
    private static final ZoneId CORRIDOR_TIME_ZONE = ZoneId.of("America/Denver");
    private static final int STAGNATION_LOOKBACK_MINUTES = 180;
    private static final int STAGNATION_WINDOW_MINUTES = 60;
    private static final int STAGNATION_EVENT_WINDOW_MINUTES = 30;
    private static final int STAGNATION_SHIFT_WINDOW_MINUTES = 15;
    private static final int STAGNATION_BASELINE_WINDOW_MINUTES = 120;
    private static final int STAGNATION_SAMPLE_LIMIT = 240;
    private static final int MIN_SIGNAL_SAMPLE_COUNT = 12;

    private final TrafficHistorySampleRepository historyRepository;
    private final IncidentEventAnalyticsRepository incidentRepository;

    TrafficStagnation(TrafficHistorySampleRepository historyRepository, IncidentEventAnalyticsRepository incidentRepository) {
        this.historyRepository = historyRepository;
        this.incidentRepository = incidentRepository;
    }

    Assessment assess(String corridor, OffsetDateTime now, TrafficSampleDto latest) {
        OperatingMode scheduledMode = scheduledOperatingMode(corridor, now);
        OffsetDateTime since = now.minusMinutes(STAGNATION_LOOKBACK_MINUTES);
        var samplePage = historyRepository.findUsableByCorridorAndPolledAtGreaterThanEqualOrderByPolledAtDesc(
            corridor,
            since,
            PageRequest.of(0, STAGNATION_SAMPLE_LIMIT)
        );
        List<TrafficHistorySample> samples = samplePage == null ? List.of() : samplePage.stream().toList();

        List<TrafficHistorySample> recentWindowSamples = samples.stream()
            .filter(sample -> sample.getPolledAt() != null && !sample.getPolledAt().isBefore(now.minusMinutes(STAGNATION_WINDOW_MINUTES)))
            .filter(sample -> sample.getAvgCurrentSpeed() != null)
            .toList();
        int usableSampleCount60m = recentWindowSamples.size();
        Integer distinctAverageCount60m = usableSampleCount60m == 0
            ? null
            : (int) recentWindowSamples.stream()
                .map(TrafficHistorySample::getAvgCurrentSpeed)
                .map(TrafficStagnation::comparableSpeed)
                .distinct()
                .count();
        Integer distinctSpeedStateCount60m = usableSampleCount60m == 0
            ? null
            : (int) recentWindowSamples.stream()
                .map(TrafficHistorySample::getSpeedStateSignature)
                .filter(value -> value != null && !value.isBlank())
                .distinct()
                .count();
        Integer distinctSemanticFlowStateCount60m = usableSampleCount60m == 0
            ? null
            : (int) recentWindowSamples.stream()
                .map(TrafficHistorySample::getSemanticFlowSignature)
                .filter(value -> value != null && !value.isBlank())
                .distinct()
                .count();
        Double repeatedStepRatio60m = repeatedStepRatio(recentWindowSamples);
        boolean semanticFlowStable = distinctSemanticFlowStateCount60m != null && distinctSemanticFlowStateCount60m <= 1;
        boolean localizedSlowdown = samples.stream().anyMatch(sample -> Boolean.TRUE.equals(sample.getLocalizedSlowdown()));
        String localizedSlowdownNote = samples.stream()
            .map(TrafficHistorySample::getLocalizedSlowdownNote)
            .filter(value -> value != null && !value.isBlank())
            .findFirst()
            .orElse(latest == null ? null : latest.localizedSlowdownNote());

        RepeatedRun repeatedRun = repeatedRun(samples);
        OffsetDateTime recentIncidentWindowStart = now.minusMinutes(STAGNATION_EVENT_WINDOW_MINUTES);
        long incidentCount30mLong = incidentRepository.countEventsOverlapping(
            corridor,
            recentIncidentWindowStart,
            now
        );
        long priorIncidentCount30mLong = incidentRepository.countEventsOverlapping(
            corridor,
            now.minusMinutes(STAGNATION_WINDOW_MINUTES),
            recentIncidentWindowStart
        );
        int incidentCount30m = safeToInt(incidentCount30mLong);
        int priorIncidentCount30m = safeToInt(priorIncidentCount30mLong);

        Double minimumSpeedDeltaFrom2hAverage = minimumSpeedDeltaFromBaseline(samples, latest, now);
        Double averageSpeedShift15m = averageSpeedShift15m(samples, latest, now);
        boolean eventActive = eventActive(incidentCount30m, priorIncidentCount30m, minimumSpeedDeltaFrom2hAverage, averageSpeedShift15m);

        OperatingMode operatingMode = eventActive ? OperatingMode.EVENT_ACTIVE : scheduledMode;
        StagnationThresholds thresholds = thresholds(corridor, operatingMode);
        int flatRunMinutes = repeatedRun.minutes();
        int flatRunRows = repeatedRun.rows();

        Severity severity = severityFor(
            thresholds,
            usableSampleCount60m,
            flatRunMinutes,
            distinctAverageCount60m,
            repeatedStepRatio60m
        );
        SignalState signalState = signalState(operatingMode, severity);
        String note = stagnationNote(
            corridor,
            scheduledMode,
            operatingMode,
            signalState,
            severity,
            eventActive,
            usableSampleCount60m,
            flatRunMinutes,
            distinctAverageCount60m,
            distinctSpeedStateCount60m,
            distinctSemanticFlowStateCount60m,
            repeatedStepRatio60m,
            semanticFlowStable,
            localizedSlowdown,
            localizedSlowdownNote,
            incidentCount30m,
            priorIncidentCount30m,
            minimumSpeedDeltaFrom2hAverage,
            averageSpeedShift15m
        );

        return new Assessment(
            operatingMode,
            signalState,
            severity,
            eventActive,
            usableSampleCount60m,
            flatRunMinutes,
            flatRunRows,
            distinctAverageCount60m,
            distinctSpeedStateCount60m,
            distinctSemanticFlowStateCount60m,
            repeatedStepRatio60m,
            semanticFlowStable,
            localizedSlowdown,
            localizedSlowdownNote,
            incidentCount30m,
            priorIncidentCount30m,
            minimumSpeedDeltaFrom2hAverage,
            averageSpeedShift15m,
            note
        );
    }

    private static OperatingMode scheduledOperatingMode(String corridor, OffsetDateTime now) {
        int hour = now.atZoneSameInstant(CORRIDOR_TIME_ZONE).getHour();
        if ("I25".equals(corridor)) {
            if (hour >= 6 && hour <= 19) return OperatingMode.ACTIVE;
            if (hour >= 20 && hour <= 21) return OperatingMode.SHOULDER;
            return OperatingMode.SMOOTH_EXPECTED;
        }
        if ("I70".equals(corridor)) {
            if ((hour >= 0 && hour <= 5) || (hour >= 15 && hour <= 17)) return OperatingMode.ACTIVE;
            if ((hour >= 6 && hour <= 14) || (hour >= 22 && hour <= 23)) return OperatingMode.SHOULDER;
            return OperatingMode.SMOOTH_EXPECTED;
        }
        if (hour >= 6 && hour <= 19) return OperatingMode.ACTIVE;
        if (hour >= 20 && hour <= 21) return OperatingMode.SHOULDER;
        return OperatingMode.SMOOTH_EXPECTED;
    }

    private static Double repeatedStepRatio(List<TrafficHistorySample> samples) {
        if (samples.size() < 2) return null;
        int repeatedSteps = 0;
        int comparisons = 0;
        for (int index = 0; index < samples.size() - 1; index++) {
            Double current = samples.get(index).getAvgCurrentSpeed();
            Double next = samples.get(index + 1).getAvgCurrentSpeed();
            if (current == null || next == null) continue;
            comparisons++;
            if (comparableSpeed(current).equals(comparableSpeed(next))) {
                repeatedSteps++;
            }
        }
        if (comparisons == 0) return null;
        return (double) repeatedSteps / comparisons;
    }

    private static RepeatedRun repeatedRun(List<TrafficHistorySample> samples) {
        String latestComparableSpeed = samples.stream()
            .map(TrafficHistorySample::getAvgCurrentSpeed)
            .filter(value -> value != null)
            .findFirst()
            .map(TrafficStagnation::comparableSpeed)
            .orElse(null);
        if (latestComparableSpeed == null || samples.isEmpty()) {
            return new RepeatedRun(0, 0);
        }

        int repeatedRows = 0;
        OffsetDateTime latestTime = null;
        OffsetDateTime earliestMatchingTime = null;
        for (TrafficHistorySample sample : samples) {
            Double avgCurrentSpeed = sample.getAvgCurrentSpeed();
            if (avgCurrentSpeed == null || sample.getPolledAt() == null) break;
            if (!latestComparableSpeed.equals(comparableSpeed(avgCurrentSpeed))) break;
            repeatedRows++;
            if (latestTime == null) {
                latestTime = sample.getPolledAt();
            }
            earliestMatchingTime = sample.getPolledAt();
        }

        int minutes = latestTime == null || earliestMatchingTime == null
            ? 0
            : (int) Math.max(0, Duration.between(earliestMatchingTime, latestTime).toMinutes());
        return new RepeatedRun(minutes, repeatedRows);
    }

    private static Double minimumSpeedDeltaFromBaseline(List<TrafficHistorySample> samples, TrafficSampleDto latest, OffsetDateTime now) {
        Double latestMinimum = latest == null ? null : latest.minCurrentSpeed();
        if (latestMinimum == null) return null;
        OffsetDateTime since = now.minusMinutes(STAGNATION_BASELINE_WINDOW_MINUTES);
        List<Double> baselineValues = samples.stream()
            .filter(sample -> sample.getPolledAt() != null && !sample.getPolledAt().isBefore(since))
            .map(TrafficHistorySample::getMinCurrentSpeed)
            .filter(value -> value != null)
            .toList();
        if (baselineValues.isEmpty()) return null;
        double average = baselineValues.stream().mapToDouble(Double::doubleValue).average().orElse(Double.NaN);
        return Double.isFinite(average) ? roundToSingleDecimal(latestMinimum - average) : null;
    }

    private static Double averageSpeedShift15m(List<TrafficHistorySample> samples, TrafficSampleDto latest, OffsetDateTime now) {
        Double latestSpeed = latest == null ? null : latest.avgCurrentSpeed();
        if (latestSpeed == null) return null;
        OffsetDateTime from = now.minusMinutes(STAGNATION_EVENT_WINDOW_MINUTES);
        OffsetDateTime until = now.minusMinutes(STAGNATION_SHIFT_WINDOW_MINUTES);
        List<Double> comparisonValues = samples.stream()
            .filter(sample -> sample.getPolledAt() != null)
            .filter(sample -> !sample.getPolledAt().isBefore(from) && !sample.getPolledAt().isAfter(until))
            .map(TrafficHistorySample::getAvgCurrentSpeed)
            .filter(value -> value != null)
            .toList();
        if (comparisonValues.isEmpty()) return null;
        double baseline = comparisonValues.stream().mapToDouble(Double::doubleValue).average().orElse(Double.NaN);
        return Double.isFinite(baseline) ? roundToSingleDecimal(latestSpeed - baseline) : null;
    }

    private static boolean eventActive(
        int incidentCount30m,
        int priorIncidentCount30m,
        Double minimumSpeedDeltaFrom2hAverage,
        Double averageSpeedShift15m
    ) {
        if (incidentCount30m >= Math.ceil(priorIncidentCount30m + 1.5d)) {
            return true;
        }
        if (minimumSpeedDeltaFrom2hAverage != null && minimumSpeedDeltaFrom2hAverage <= -8.0) {
            return true;
        }
        return averageSpeedShift15m != null && Math.abs(averageSpeedShift15m) >= 3.0;
    }

    private static StagnationThresholds thresholds(String corridor, OperatingMode operatingMode) {
        boolean i25 = "I25".equals(corridor);
        boolean i70 = "I70".equals(corridor);
        return switch (operatingMode) {
            case ACTIVE, EVENT_ACTIVE -> {
                if (i25) {
                    yield new StagnationThresholds(15, 30, 45, 6, 3, 2, 0.80);
                }
                if (i70) {
                    yield new StagnationThresholds(20, 40, 60, 5, 3, 2, 0.85);
                }
                yield new StagnationThresholds(20, 40, 60, 5, 3, 2, 0.85);
            }
            case SHOULDER -> {
                if (i25) {
                    yield new StagnationThresholds(25, 45, 75, 4, 2, 1, 0.88);
                }
                if (i70) {
                    yield new StagnationThresholds(30, 60, 90, 4, 2, 1, 0.90);
                }
                yield new StagnationThresholds(30, 60, 90, 4, 2, 1, 0.90);
            }
            case SMOOTH_EXPECTED -> {
                if (i25) {
                    yield new StagnationThresholds(45, 90, 150, 2, 1, 1, 0.95);
                }
                if (i70) {
                    yield new StagnationThresholds(60, 120, 180, 2, 1, 1, 0.97);
                }
                yield new StagnationThresholds(60, 120, 180, 2, 1, 1, 0.97);
            }
        };
    }

    private static Severity severityFor(
        StagnationThresholds thresholds,
        int usableSampleCount60m,
        int flatRunMinutes,
        Integer distinctAverageCount60m,
        Double repeatedStepRatio60m
    ) {
        if (usableSampleCount60m < MIN_SIGNAL_SAMPLE_COUNT) {
            return Severity.NORMAL;
        }

        boolean critical = flatRunMinutes >= thresholds.criticalFlatMinutes()
            && distinctAverageCount60m != null
            && distinctAverageCount60m <= thresholds.criticalDistinctCount();
        if (critical) return Severity.CRITICAL;

        boolean warn = flatRunMinutes >= thresholds.warnFlatMinutes()
            || (distinctAverageCount60m != null && distinctAverageCount60m <= thresholds.warnDistinctCount())
            || (repeatedStepRatio60m != null && repeatedStepRatio60m >= thresholds.warnRepeatedStepRatio());
        if (warn) return Severity.WARN;

        boolean info = flatRunMinutes >= thresholds.infoFlatMinutes()
            || (distinctAverageCount60m != null && distinctAverageCount60m <= thresholds.infoDistinctCount());
        return info ? Severity.INFO : Severity.NORMAL;
    }

    private static SignalState signalState(OperatingMode operatingMode, Severity severity) {
        if (severity == Severity.CRITICAL) return SignalState.STAGNATION_ALERT;
        if (severity == Severity.WARN) return SignalState.WATCH;
        if (operatingMode == OperatingMode.EVENT_ACTIVE) return SignalState.EVENT_ACTIVE;
        if (operatingMode == OperatingMode.SMOOTH_EXPECTED) return SignalState.FRESH_SMOOTH;
        return severity == Severity.INFO ? SignalState.SMOOTHING : SignalState.FRESH_CHANGING;
    }

    private static String stagnationNote(
        String corridor,
        OperatingMode scheduledMode,
        OperatingMode operatingMode,
        SignalState signalState,
        Severity severity,
        boolean eventActive,
        int usableSampleCount60m,
        int flatRunMinutes,
        Integer distinctAverageCount60m,
        Integer distinctSpeedStateCount60m,
        Integer distinctSemanticFlowStateCount60m,
        Double repeatedStepRatio60m,
        boolean semanticFlowStable,
        boolean localizedSlowdown,
        String localizedSlowdownNote,
        int incidentCount30m,
        int priorIncidentCount30m,
        Double minimumSpeedDeltaFrom2hAverage,
        Double averageSpeedShift15m
    ) {
        if (usableSampleCount60m < MIN_SIGNAL_SAMPLE_COUNT) {
            return String.format(
                Locale.US,
                "Only %d usable speed samples landed in the last hour, so stagnation checks are still warming up.",
                usableSampleCount60m
            );
        }
        if (eventActive) {
            List<String> triggers = new ArrayList<>();
            if (incidentCount30m >= Math.ceil(priorIncidentCount30m + 1.5d)) {
                triggers.add(String.format(
                    Locale.US,
                    "incident threads rose from %d to %d between consecutive 30-minute windows",
                    priorIncidentCount30m,
                    incidentCount30m
                ));
            }
            if (minimumSpeedDeltaFrom2hAverage != null && minimumSpeedDeltaFrom2hAverage <= -8.0) {
                triggers.add(String.format(Locale.US, "the slowest segment is %s versus the trailing 2h norm", formatSignedMph(minimumSpeedDeltaFrom2hAverage)));
            }
            if (averageSpeedShift15m != null && Math.abs(averageSpeedShift15m) >= 3.0) {
                triggers.add(String.format(Locale.US, "average speed shifted %s over 15 minutes", formatSignedMph(averageSpeedShift15m)));
            }
            return "Event-active monitoring is in effect because " + String.join(", ", triggers) + ".";
        }
        if (localizedSlowdown && localizedSlowdownNote != null && !localizedSlowdownNote.isBlank()) {
            if (semanticFlowStable && (distinctAverageCount60m == null || distinctAverageCount60m <= 1)) {
                return localizedSlowdownNote + " The decoded mainline speed state is otherwise holding steady.";
            }
            return localizedSlowdownNote;
        }
        if (severity == Severity.CRITICAL || severity == Severity.WARN) {
            return String.format(
                Locale.US,
                "%s is holding a repeated speed state for about %d minutes with %d distinct hourly-window averages, %d speed-state signatures, %d semantic flow states, and %.0f%% repeated steps, which is outside the expected %s baseline.",
                corridor,
                flatRunMinutes,
                distinctAverageCount60m == null ? 0 : distinctAverageCount60m,
                distinctSpeedStateCount60m == null ? 0 : distinctSpeedStateCount60m,
                distinctSemanticFlowStateCount60m == null ? 0 : distinctSemanticFlowStateCount60m,
                repeatedStepRatio60m == null ? 0.0 : repeatedStepRatio60m * 100.0,
                operatingMode == OperatingMode.SMOOTH_EXPECTED ? "smooth-period" : operatingMode.name().toLowerCase(Locale.ROOT).replace('_', '-')
            );
        }
        if (signalState == SignalState.FRESH_SMOOTH) {
            return String.format(
                Locale.US,
                "The current hour fits the smoother off-hour baseline for %s, so steadier readings are expected unless incidents or speed drops spike.",
                corridor
            );
        }
        if (signalState == SignalState.SMOOTHING) {
            return String.format(
                Locale.US,
                "%s is leaning smooth right now, but it is still within the expected %s window for this corridor.",
                corridor,
                scheduledMode.name().toLowerCase(Locale.ROOT).replace('_', '-')
            );
        }
        return String.format(
            Locale.US,
            "%s is showing enough movement for the current %s baseline: %d distinct averages in the last hour and %.0f%% repeated steps.",
            corridor,
            scheduledMode.name().toLowerCase(Locale.ROOT).replace('_', '-'),
            distinctAverageCount60m == null ? 0 : distinctAverageCount60m,
            repeatedStepRatio60m == null ? 0.0 : repeatedStepRatio60m * 100.0
        );
    }

    private static String comparableSpeed(Double speed) {
        return String.format(Locale.US, "%.6f", speed);
    }

    private static int safeToInt(long value) {
        return (int) Math.max(Integer.MIN_VALUE, Math.min(Integer.MAX_VALUE, value));
    }

    private static String formatSignedMph(double value) {
        return String.format(Locale.US, "%+.1f mph", roundToSingleDecimal(value));
    }

    private static double roundToSingleDecimal(double value) {
        return Math.round(value * 10.0) / 10.0;
    }

    private record RepeatedRun(
        int minutes,
        int rows
    ) {}

    private record StagnationThresholds(
        int infoFlatMinutes,
        int warnFlatMinutes,
        int criticalFlatMinutes,
        int infoDistinctCount,
        int warnDistinctCount,
        int criticalDistinctCount,
        double warnRepeatedStepRatio
    ) {}

    record Assessment(
        OperatingMode operatingMode,
        SignalState signalState,
        Severity severity,
        boolean eventActive,
        Integer recentUsableSampleCount60m,
        Integer flatRunMinutes,
        Integer flatRunRows,
        Integer distinctAverageCount60m,
        Integer distinctSpeedStateCount60m,
        Integer distinctSemanticFlowStateCount60m,
        Double repeatedStepRatio60m,
        Boolean semanticFlowStable,
        Boolean localizedSlowdown,
        String localizedSlowdownNote,
        Integer incidentCount30m,
        Integer priorIncidentCount30m,
        Double minimumSpeedDeltaFrom2hAverage,
        Double averageSpeedShift15m,
        String note
    ) {
        TrafficStagnationAssessmentDto toDto() {
            return new TrafficStagnationAssessmentDto(
                operatingMode.name(),
                signalState.name(),
                severity.name(),
                eventActive,
                recentUsableSampleCount60m,
                flatRunMinutes,
                flatRunRows,
                distinctAverageCount60m,
                distinctSpeedStateCount60m,
                distinctSemanticFlowStateCount60m,
                repeatedStepRatio60m == null ? null : roundToSingleDecimal(repeatedStepRatio60m * 100.0) / 100.0,
                semanticFlowStable,
                localizedSlowdown,
                localizedSlowdownNote,
                incidentCount30m,
                priorIncidentCount30m,
                minimumSpeedDeltaFrom2hAverage,
                averageSpeedShift15m,
                note
            );
        }
    }

    private enum OperatingMode {
        ACTIVE,
        SHOULDER,
        SMOOTH_EXPECTED,
        EVENT_ACTIVE
    }

    private enum SignalState {
        FRESH_CHANGING,
        SMOOTHING,
        FRESH_SMOOTH,
        EVENT_ACTIVE,
        WATCH,
        STAGNATION_ALERT
    }

    private enum Severity {
        NORMAL,
        INFO,
        WARN,
        CRITICAL
    }
}
