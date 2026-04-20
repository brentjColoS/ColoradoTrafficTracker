package com.example.api_service;

import com.example.api_service.dto.CorridorAnalyticsSummaryDto;
import com.example.api_service.dto.IncidentHotspotDto;
import com.example.api_service.dto.TrafficDashboardSummaryDto;
import com.example.api_service.dto.TrafficProviderGuardStatusDto;
import com.example.api_service.dto.TrafficSampleDto;
import com.example.api_service.dto.TrafficSampleMapper;
import java.time.Duration;
import java.time.OffsetDateTime;
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

    private final TrafficSampleRepository sampleRepository;
    private final TrafficAnalyticsRepository analyticsRepository;
    private final TrafficHistoryIncidentRepository incidentRepository;
    private final ObjectProvider<TrafficProviderGuardStatusRepository> statusRepositoryProvider;
    private final DashboardProps dashboardProps;

    public TrafficDashboardController(
        TrafficSampleRepository sampleRepository,
        TrafficAnalyticsRepository analyticsRepository,
        TrafficHistoryIncidentRepository incidentRepository,
        ObjectProvider<TrafficProviderGuardStatusRepository> statusRepositoryProvider,
        DashboardProps dashboardProps
    ) {
        this.sampleRepository = sampleRepository;
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
            .findHotspotsByCorridor(normalized, summarySince, 1)
            .stream()
            .findFirst()
            .map(TrafficDashboardController::toIncidentHotspotDto)
            .orElse(null);

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

        TrafficProviderGuardStatusDto providerStatus = providerStatus(now);

        return ResponseEntity.ok(new TrafficDashboardSummaryDto(
            normalized,
            now,
            windowHours,
            recentIncidentWindowMinutes,
            providerStatus,
            latestDto,
            corridorSummary,
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
                recentMissingMileMarkerCount
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
        long recentMissingMileMarkerCount
    ) {
        List<String> notes = new ArrayList<>();
        String sourceMode = latest == null ? "" : String.valueOf(latest.sourceMode()).trim().toLowerCase(Locale.ROOT);

        if ("tile".equals(sourceMode)) {
            notes.add("Tile-mode sampling is active, so the dashboard emphasizes rolling-average delta, slowest segment speed, and freshness instead of freeflow and confidence.");
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
        return notes;
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

    private static IncidentHotspotDto toIncidentHotspotDto(TrafficIncidentHotspotProjection row) {
        return new IncidentHotspotDto(
            row.getCorridor(),
            row.getTravelDirection(),
            directionLabel(row.getTravelDirection()),
            row.getMileMarkerBand(),
            referenceLabel(row.getCorridor(), row.getTravelDirection(), row.getMileMarkerBand()),
            row.getObservationCount(),
            row.getIncidentCount(),
            row.getAvgDelaySeconds(),
            row.getMaxDelaySeconds(),
            row.getArchivedObservationCount(),
            row.getArchivedIncidentCount(),
            row.getFirstSeenAt() == null ? null : OffsetDateTime.ofInstant(row.getFirstSeenAt(), ZoneOffset.UTC),
            row.getLastSeenAt() == null ? null : OffsetDateTime.ofInstant(row.getLastSeenAt(), ZoneOffset.UTC)
        );
    }

    private static String normalizeCorridor(String corridor) {
        if (corridor == null) return null;
        String value = corridor.trim().toUpperCase(Locale.ROOT);
        return value.isBlank() ? null : value;
    }

    private static String normalizeDirection(String direction) {
        if (direction == null || direction.isBlank()) return null;
        return direction.trim().toUpperCase(Locale.ROOT);
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

    private static double roundToSingleDecimal(double value) {
        return Math.round(value * 10.0) / 10.0;
    }

    private record FreshnessAssessment(
        Integer statusAgeMinutes,
        String freshnessState,
        boolean stale
    ) {}
}
