package com.example.api_service;

import com.example.api_service.dto.CorridorAnalyticsSummaryDto;
import com.example.api_service.dto.IncidentHotspotDto;
import com.example.api_service.dto.TrafficDashboardSummaryDto;
import com.example.api_service.dto.TrafficProviderGuardStatusDto;
import com.example.api_service.dto.TrafficSampleDto;
import com.example.api_service.dto.TrafficSampleMapper;
import com.example.api_service.dto.TrafficStagnationAssessmentDto;
import java.time.Duration;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Optional;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.cache.annotation.Cacheable;
import org.springframework.data.domain.PageRequest;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping({"/api/traffic", "/dashboard-api/traffic"})
public class TrafficDashboardController {
    private static final String PROVIDER_NAME = "tomtom";
    private static final int MAX_WINDOW_HOURS = 8_760;
    private static final int MAX_RECENT_INCIDENT_WINDOW_MINUTES = 10_080;
    private static final int STALE_SAMPLE_MINUTES = 180;
    private static final ZoneId CORRIDOR_TIME_ZONE = ZoneId.of("America/Denver");
    private static final int STAGNATION_LOOKBACK_MINUTES = 180;
    private static final int STAGNATION_WINDOW_MINUTES = 60;
    private static final int STAGNATION_EVENT_WINDOW_MINUTES = 30;
    private static final int STAGNATION_SHIFT_WINDOW_MINUTES = 15;
    private static final int STAGNATION_BASELINE_WINDOW_MINUTES = 120;
    private static final int STAGNATION_SAMPLE_LIMIT = 240;
    private static final int MIN_SIGNAL_SAMPLE_COUNT = 12;

    private final TrafficSampleRepository sampleRepository;
    private final TrafficHistorySampleRepository historyRepository;
    private final TrafficAnalyticsRepository analyticsRepository;
    private final TrafficHistoryIncidentRepository incidentRepository;
    private final ObjectProvider<TrafficProviderGuardStatusRepository> statusRepositoryProvider;
    private final DashboardProps dashboardProps;

    public TrafficDashboardController(
        TrafficSampleRepository sampleRepository,
        TrafficHistorySampleRepository historyRepository,
        TrafficAnalyticsRepository analyticsRepository,
        TrafficHistoryIncidentRepository incidentRepository,
        ObjectProvider<TrafficProviderGuardStatusRepository> statusRepositoryProvider,
        DashboardProps dashboardProps
    ) {
        this.sampleRepository = sampleRepository;
        this.historyRepository = historyRepository;
        this.analyticsRepository = analyticsRepository;
        this.incidentRepository = incidentRepository;
        this.statusRepositoryProvider = statusRepositoryProvider;
        this.dashboardProps = dashboardProps;
    }

    @GetMapping("/summary")
    @Cacheable(
        cacheNames = "apiHistory",
        key = "'dashboard-summary|' + #p0 + '|' + #p1 + '|' + #p2 + '|' + #p3",
        unless = "#result == null || #result.statusCodeValue != 200"
    )
    public ResponseEntity<TrafficDashboardSummaryDto> summary(
        @RequestParam("corridor") String corridor,
        @RequestParam(name = "windowHours", defaultValue = "168") int windowHours,
        @RequestParam(name = "recentIncidentWindowMinutes", defaultValue = "720") int recentIncidentWindowMinutes,
        @RequestParam(name = "preferUsable", defaultValue = "true") boolean preferUsable
    ) {
        String normalized = normalizeCorridor(corridor);
        if (normalized == null) return ResponseEntity.badRequest().build();
        if (windowHours < 1 || windowHours > MAX_WINDOW_HOURS) return ResponseEntity.badRequest().build();
        if (recentIncidentWindowMinutes < 1 || recentIncidentWindowMinutes > MAX_RECENT_INCIDENT_WINDOW_MINUTES) {
            return ResponseEntity.badRequest().build();
        }

        OffsetDateTime now = OffsetDateTime.now(ZoneOffset.UTC);
        OffsetDateTime summarySince = now.minusHours(windowHours);
        OffsetDateTime recentIncidentSince = now.minusMinutes(recentIncidentWindowMinutes);

        TrafficSample latestSample = preferUsable
            ? sampleRepository.findLatestUsableByCorridor(normalized, PageRequest.of(0, 1)).stream().findFirst().orElse(null)
            : null;
        if (latestSample == null) {
            latestSample = sampleRepository.findFirstByCorridorOrderByPolledAtDesc(normalized).orElse(null);
        }
        TrafficSampleDto latestDto = latestSample == null ? null : TrafficSampleMapper.toDto(latestSample);

        CorridorAnalyticsSummaryDto corridorSummary = analyticsRepository
            .summarizeCorridorWithSpeed(normalized, summarySince)
            .stream()
            .findFirst()
            .map(TrafficDashboardController::toCorridorSummaryDto)
            .orElse(null);

        IncidentHotspotDto topHotspot = analyticsRepository
            .findHotspotsByCorridor(normalized, summarySince, 10)
            .stream()
            .collect(java.util.stream.Collectors.collectingAndThen(
                java.util.stream.Collectors.toList(),
                rows -> IncidentHotspotSupport.top(rows, now)
            ));

        long recentObservationCount = incidentRepository.countByCorridorAndPolledAtGreaterThanEqual(normalized, recentIncidentSince);
        long recentMissingMileMarkerCount = incidentRepository
            .countByCorridorAndPolledAtGreaterThanEqualAndClosestMileMarkerIsNull(normalized, recentIncidentSince);
        long recentReferenceCount = incidentRepository
            .countDistinctReferencesByCorridorAndPolledAtGreaterThanEqual(normalized, recentIncidentSince);

        Integer sampleAgeMinutes = latestDto == null || latestDto.polledAt() == null
            ? null
            : (int) Math.max(0, Duration.between(latestDto.polledAt(), now).toMinutes());

        Double speedDeltaFromWindowAverage = latestDto == null || latestDto.avgCurrentSpeed() == null || corridorSummary == null
            ? null
            : roundToSingleDecimal(latestDto.avgCurrentSpeed() - corridorSummary.avgCurrentSpeed());
        StagnationAssessment stagnationAssessment = stagnationAssessment(normalized, now, latestDto);

        TrafficProviderGuardStatusDto providerStatus = providerStatus(now);

        return ResponseEntity.ok(new TrafficDashboardSummaryDto(
            normalized,
            now,
            windowHours,
            recentIncidentWindowMinutes,
            providerStatus,
            latestDto,
            corridorSummary,
            stagnationAssessment.toDto(),
            topHotspot,
            sampleAgeMinutes,
            speedDeltaFromWindowAverage,
            recentObservationCount,
            recentReferenceCount,
            recentMissingMileMarkerCount,
            buildNotes(
                providerStatus,
                latestDto,
                sampleAgeMinutes,
                corridorSummary,
                windowHours,
                speedDeltaFromWindowAverage,
                recentObservationCount,
                recentMissingMileMarkerCount,
                stagnationAssessment
            )
        ));
    }

    private TrafficProviderGuardStatusDto providerStatus(OffsetDateTime now) {
        TrafficProviderGuardStatusRepository statusRepository = statusRepositoryProvider.getIfAvailable();
        TrafficProviderGuardStatus status = Optional.ofNullable(statusRepository)
            .flatMap(repository -> repository.findById(PROVIDER_NAME))
            .orElse(null);
        if (status == null) {
            return new TrafficProviderGuardStatusDto(
                PROVIDER_NAME,
                "UNKNOWN",
                false,
                null,
                "No provider guard status has been recorded yet.",
                null,
                0,
                0,
                null,
                null,
                null,
                null,
                null,
                "UNKNOWN",
                false
            );
        }

        FreshnessAssessment freshness = freshness(status.getLastCheckedAt(), now);
        return new TrafficProviderGuardStatusDto(
            status.getProviderName(),
            status.getState(),
            status.isHalted(),
            status.getFailureCode(),
            status.getMessage(),
            status.getDetailsJson(),
            status.getConsecutiveNullCycles(),
            status.getConsecutiveStaleCycles(),
            status.getLastCheckedAt(),
            status.getLastSuccessAt(),
            status.getLastFailureAt(),
            status.getShutdownTriggeredAt(),
            freshness.statusAgeMinutes(),
            freshness.freshnessState(),
            freshness.stale()
        );
    }

    private FreshnessAssessment freshness(OffsetDateTime lastCheckedAt, OffsetDateTime now) {
        if (lastCheckedAt == null) {
            return new FreshnessAssessment(null, "UNKNOWN", false);
        }

        int ageMinutes = (int) Math.max(0, Duration.between(lastCheckedAt, now).toMinutes());
        int staleAfterMinutes = Math.max(5, dashboardProps.providerStatusStaleAfterMinutes());
        boolean stale = ageMinutes >= staleAfterMinutes;
        return new FreshnessAssessment(ageMinutes, stale ? "STALE" : "FRESH", stale);
    }

    private static List<String> buildNotes(
        TrafficProviderGuardStatusDto providerStatus,
        TrafficSampleDto latest,
        Integer sampleAgeMinutes,
        CorridorAnalyticsSummaryDto corridorSummary,
        int windowHours,
        Double speedDeltaFromWindowAverage,
        long recentObservationCount,
        long recentMissingMileMarkerCount,
        StagnationAssessment stagnationAssessment
    ) {
        List<String> notes = new ArrayList<>();
        String sourceMode = latest == null ? "" : String.valueOf(latest.sourceMode()).trim().toLowerCase(Locale.ROOT);

        if ("tile".equals(sourceMode)) {
            notes.add("Tile-mode sampling is active, so the dashboard emphasizes rolling-average delta, slowest segment speed, and freshness instead of freeflow and confidence.");
        } else if ("hybrid".equals(sourceMode)) {
            notes.add("Hybrid sampling is active, so corridor speed uses route-point validation while incidents and corridor coverage still come from tile mode.");
        }
        if (latest != null && Boolean.TRUE.equals(latest.degraded())) {
            String degradedReason = latest.degradedReason();
            if (degradedReason != null && !degradedReason.isBlank()) {
                notes.add(degradedReason);
            } else {
                notes.add("Latest speed sample is degraded, so the corridor speed fell back to a lower-confidence source.");
            }
        } else if (latest != null
            && Boolean.TRUE.equals(latest.validationUsed())
            && latest.validationRequestedPoints() != null
            && latest.validationReturnedPoints() != null) {
            notes.add(String.format(
                Locale.US,
                "Route-point validation accepted %d of %d requested speed checks for the latest sample.",
                latest.validationReturnedPoints(),
                latest.validationRequestedPoints()
            ));
        }
        if (providerStatus.halted()) {
            notes.add(providerStatus.message() == null || providerStatus.message().isBlank()
                ? "Traffic ingestion is currently halted by the provider guard."
                : providerStatus.message());
        } else if (providerStatus.stale()) {
            notes.add("Provider guard status is stale, so system health may lag until the next successful guard refresh.");
        }
        if (sampleAgeMinutes != null && sampleAgeMinutes > STALE_SAMPLE_MINUTES) {
            notes.add(String.format(Locale.US, "Latest usable speed sample is %d minutes old, which is outside the expected live window.", sampleAgeMinutes));
        }
        if (corridorSummary == null) {
            notes.add("Rolling corridor analytics are not available yet for the selected window.");
        } else if (speedDeltaFromWindowAverage != null && speedDeltaFromWindowAverage <= -10.0) {
            notes.add(String.format(
                Locale.US,
                "Current speed is %.1f mph below the rolling %dh corridor average.",
                Math.abs(speedDeltaFromWindowAverage),
                windowHours
            ));
        }
        if (recentObservationCount > 0 && recentMissingMileMarkerCount > 0) {
            if (recentObservationCount == recentMissingMileMarkerCount) {
                notes.add("Recent incidents are missing mile markers, so references fall back to corridor and direction only.");
            } else {
                notes.add(String.format(
                    Locale.US,
                    "%d of %d recent incidents are still missing mile markers, so some references remain approximate.",
                    recentMissingMileMarkerCount,
                    recentObservationCount
                ));
            }
        }
        if (stagnationAssessment != null && stagnationAssessment.note() != null && !stagnationAssessment.note().isBlank()) {
            notes.add(stagnationAssessment.note());
        }
        return notes;
    }

    private StagnationAssessment stagnationAssessment(String corridor, OffsetDateTime now, TrafficSampleDto latest) {
        ScheduledOperatingMode scheduledMode = scheduledOperatingMode(corridor, now);
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
                .map(TrafficDashboardController::comparableSpeed)
                .distinct()
                .count();
        Double repeatedStepRatio60m = repeatedStepRatio(recentWindowSamples);

        RepeatedRun repeatedRun = repeatedRun(samples);
        long incidentCount30mLong = incidentRepository.countByCorridorAndPolledAtGreaterThanEqual(
            corridor,
            now.minusMinutes(STAGNATION_EVENT_WINDOW_MINUTES)
        );
        long incidentCount60mLong = incidentRepository.countByCorridorAndPolledAtGreaterThanEqual(
            corridor,
            now.minusMinutes(STAGNATION_WINDOW_MINUTES)
        );
        int incidentCount30m = safeToInt(incidentCount30mLong);
        int priorIncidentCount30m = safeToInt(Math.max(0L, incidentCount60mLong - incidentCount30mLong));

        Double minimumSpeedDeltaFrom2hAverage = minimumSpeedDeltaFromBaseline(samples, latest, now);
        Double averageSpeedShift15m = averageSpeedShift15m(samples, latest, now);
        boolean eventActive = eventActive(incidentCount30m, priorIncidentCount30m, minimumSpeedDeltaFrom2hAverage, averageSpeedShift15m);

        OperatingMode operatingMode = eventActive ? OperatingMode.EVENT_ACTIVE : scheduledMode.toOperatingMode();
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
            repeatedStepRatio60m,
            incidentCount30m,
            priorIncidentCount30m,
            minimumSpeedDeltaFrom2hAverage,
            averageSpeedShift15m
        );

        return new StagnationAssessment(
            operatingMode,
            signalState,
            severity,
            eventActive,
            usableSampleCount60m,
            flatRunMinutes,
            flatRunRows,
            distinctAverageCount60m,
            repeatedStepRatio60m,
            incidentCount30m,
            priorIncidentCount30m,
            minimumSpeedDeltaFrom2hAverage,
            averageSpeedShift15m,
            note
        );
    }

    private static CorridorAnalyticsSummaryDto toCorridorSummaryDto(TrafficCorridorSummaryProjection row) {
        return new CorridorAnalyticsSummaryDto(
            row.getCorridor(),
            row.getBucketCount(),
            row.getSampleCount(),
            row.getAvgCurrentSpeed(),
            row.getMinCurrentSpeed(),
            row.getAvgSpeedStddev(),
            row.getTotalIncidentCount(),
            row.getFirstBucketStart() == null ? null : OffsetDateTime.ofInstant(row.getFirstBucketStart(), ZoneOffset.UTC),
            row.getLastBucketStart() == null ? null : OffsetDateTime.ofInstant(row.getLastBucketStart(), ZoneOffset.UTC)
        );
    }

    private static String normalizeCorridor(String corridor) {
        if (corridor == null) return null;
        String value = corridor.trim().toUpperCase(Locale.ROOT);
        return value.isBlank() ? null : value;
    }

    private static double roundToSingleDecimal(double value) {
        return Math.round(value * 10.0) / 10.0;
    }

    private static ScheduledOperatingMode scheduledOperatingMode(String corridor, OffsetDateTime now) {
        int hour = now.atZoneSameInstant(CORRIDOR_TIME_ZONE).getHour();
        if ("I25".equals(corridor)) {
            if (hour >= 6 && hour <= 19) return ScheduledOperatingMode.ACTIVE;
            if (hour >= 20 && hour <= 21) return ScheduledOperatingMode.SHOULDER;
            return ScheduledOperatingMode.SMOOTH_EXPECTED;
        }
        if ("I70".equals(corridor)) {
            if ((hour >= 0 && hour <= 5) || (hour >= 15 && hour <= 17)) return ScheduledOperatingMode.ACTIVE;
            if ((hour >= 6 && hour <= 14) || (hour >= 22 && hour <= 23)) return ScheduledOperatingMode.SHOULDER;
            return ScheduledOperatingMode.SMOOTH_EXPECTED;
        }
        if (hour >= 6 && hour <= 19) return ScheduledOperatingMode.ACTIVE;
        if (hour >= 20 && hour <= 21) return ScheduledOperatingMode.SHOULDER;
        return ScheduledOperatingMode.SMOOTH_EXPECTED;
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
            .map(TrafficDashboardController::comparableSpeed)
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
        ScheduledOperatingMode scheduledMode,
        OperatingMode operatingMode,
        SignalState signalState,
        Severity severity,
        boolean eventActive,
        int usableSampleCount60m,
        int flatRunMinutes,
        Integer distinctAverageCount60m,
        Double repeatedStepRatio60m,
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
                triggers.add(String.format(Locale.US, "incident activity rose from %d to %d in the last 30 minutes", priorIncidentCount30m, incidentCount30m));
            }
            if (minimumSpeedDeltaFrom2hAverage != null && minimumSpeedDeltaFrom2hAverage <= -8.0) {
                triggers.add(String.format(Locale.US, "the slowest segment is %s versus the trailing 2h norm", formatSignedMph(minimumSpeedDeltaFrom2hAverage)));
            }
            if (averageSpeedShift15m != null && Math.abs(averageSpeedShift15m) >= 3.0) {
                triggers.add(String.format(Locale.US, "average speed shifted %s over 15 minutes", formatSignedMph(averageSpeedShift15m)));
            }
            return "Event-active monitoring is in effect because " + String.join(", ", triggers) + ".";
        }
        if (severity == Severity.CRITICAL || severity == Severity.WARN) {
            return String.format(
                Locale.US,
                "%s is holding a repeated speed state for about %d minutes with %d distinct hourly-window averages and %.0f%% repeated steps, which is outside the expected %s baseline.",
                corridor,
                flatRunMinutes,
                distinctAverageCount60m == null ? 0 : distinctAverageCount60m,
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

    private record FreshnessAssessment(
        Integer statusAgeMinutes,
        String freshnessState,
        boolean stale
    ) {}

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

    private record StagnationAssessment(
        OperatingMode operatingMode,
        SignalState signalState,
        Severity severity,
        boolean eventActive,
        Integer recentUsableSampleCount60m,
        Integer flatRunMinutes,
        Integer flatRunRows,
        Integer distinctAverageCount60m,
        Double repeatedStepRatio60m,
        Integer incidentCount30m,
        Integer priorIncidentCount30m,
        Double minimumSpeedDeltaFrom2hAverage,
        Double averageSpeedShift15m,
        String note
    ) {
        private TrafficStagnationAssessmentDto toDto() {
            return new TrafficStagnationAssessmentDto(
                operatingMode.name(),
                signalState.name(),
                severity.name(),
                eventActive,
                recentUsableSampleCount60m,
                flatRunMinutes,
                flatRunRows,
                distinctAverageCount60m,
                repeatedStepRatio60m == null ? null : roundToSingleDecimal(repeatedStepRatio60m * 100.0) / 100.0,
                incidentCount30m,
                priorIncidentCount30m,
                minimumSpeedDeltaFrom2hAverage,
                averageSpeedShift15m,
                note
            );
        }
    }

    private enum ScheduledOperatingMode {
        ACTIVE,
        SHOULDER,
        SMOOTH_EXPECTED;

        private OperatingMode toOperatingMode() {
            return switch (this) {
                case ACTIVE -> OperatingMode.ACTIVE;
                case SHOULDER -> OperatingMode.SHOULDER;
                case SMOOTH_EXPECTED -> OperatingMode.SMOOTH_EXPECTED;
            };
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
