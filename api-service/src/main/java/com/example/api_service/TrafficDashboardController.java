package com.example.api_service;

import static com.example.api_service.CorridorCodes.normalizeCorridor;

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
    private final TrafficStagnation stagnation;
    private final TrafficAnalyticsRepository analyticsRepository;
    private final IncidentEventAnalyticsRepository incidentRepository;
    private final ObjectProvider<TrafficProviderGuardStatusRepository> statusRepositoryProvider;
    private final DashboardProps dashboardProps;

    public TrafficDashboardController(
        TrafficSampleRepository sampleRepository,
        TrafficHistorySampleRepository historyRepository,
        TrafficAnalyticsRepository analyticsRepository,
        IncidentEventAnalyticsRepository incidentRepository,
        ObjectProvider<TrafficProviderGuardStatusRepository> statusRepositoryProvider,
        DashboardProps dashboardProps
    ) {
        this.sampleRepository = sampleRepository;
        this.stagnation = new TrafficStagnation(historyRepository, incidentRepository);
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

        TrafficSample latestSample = LatestTrafficSamples.find(sampleRepository, normalized, preferUsable).orElse(null);
        TrafficSampleDto latestDto = latestSample == null ? null : TrafficSampleMapper.toDto(latestSample);

        CorridorAnalyticsSummaryDto corridorSummary = analyticsRepository
            .summarizeCorridorWithSpeed(normalized, summarySince)
            .stream()
            .findFirst()
            .map(row -> toCorridorSummaryDto(
                row,
                incidentRepository.countEventsOverlapping(normalized, summarySince, now)
            ))
            .orElse(null);

        IncidentHotspotDto topHotspot = incidentRepository
            .findHotspotsByCorridor(normalized, summarySince, 10)
            .stream()
            .collect(java.util.stream.Collectors.collectingAndThen(
                java.util.stream.Collectors.toList(),
                rows -> IncidentHotspotSupport.top(rows, now)
            ));

        long recentObservationCount = incidentRepository.countRecentMatches(normalized, recentIncidentSince);
        long recentMissingMileMarkerCount = incidentRepository
            .countRecentMatchesWithoutMileMarker(normalized, recentIncidentSince);
        long recentReferenceCount = incidentRepository
            .countRecentEvents(normalized, recentIncidentSince);

        Integer sampleAgeMinutes = latestDto == null || latestDto.polledAt() == null
            ? null
            : (int) Math.max(0, Duration.between(latestDto.polledAt(), now).toMinutes());

        Double speedDeltaFromWindowAverage = latestDto == null || latestDto.avgCurrentSpeed() == null || corridorSummary == null
            ? null
            : roundToSingleDecimal(latestDto.avgCurrentSpeed() - corridorSummary.avgCurrentSpeed());
        var stagnationAssessment = stagnation.assess(normalized, now, latestDto);

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

    public record CurrentSummary(String corridor, OffsetDateTime generatedAt,
        TrafficSampleDto latest, TrafficProviderGuardStatusDto providerStatus) {}

    public ResponseEntity<CurrentSummary> currentSummary(String corridor) {
        TrafficSample sample = LatestTrafficSamples.find(sampleRepository, corridor, true).orElse(null);
        OffsetDateTime now = OffsetDateTime.now(ZoneOffset.UTC);
        return ResponseEntity.ok(new CurrentSummary(corridor, now,
            sample == null ? null : TrafficSampleMapper.toDto(sample), providerStatus(now)));
    }

    private TrafficProviderGuardStatusDto providerStatus(OffsetDateTime now) {
        TrafficProviderGuardStatusRepository statusRepository = statusRepositoryProvider.getIfAvailable();
        TrafficProviderGuardStatus status = Optional.ofNullable(statusRepository)
            .flatMap(repository -> repository.findById(PROVIDER_NAME))
            .orElse(null);
        return TrafficProviderGuardPresentation.toDto(status, now, dashboardProps.providerStatusStaleAfterMinutes());
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
        TrafficStagnation.Assessment stagnationAssessment
    ) {
        List<String> notes = new ArrayList<>();
        String sourceMode = latest == null ? "" : String.valueOf(latest.sourceMode()).trim().toLowerCase(Locale.ROOT);

        if ("tile".equals(sourceMode)) {
            notes.add("Tile-mode sampling is active, so the dashboard emphasizes rolling-average delta, slowest segment speed, and freshness instead of freeflow and confidence.");
        }
        if (latest != null && Boolean.TRUE.equals(latest.localizedSlowdown())
            && latest.localizedSlowdownNote() != null && !latest.localizedSlowdownNote().isBlank()) {
            notes.add(latest.localizedSlowdownNote());
        }
        if (providerStatus.halted()) {
            notes.add(providerStatus.message() == null || providerStatus.message().isBlank()
                ? "Traffic ingestion is currently halted by the provider guard."
                : providerStatus.message());
        } else if ("RECOVERING".equalsIgnoreCase(providerStatus.state())) {
            notes.add(providerStatus.message() == null || providerStatus.message().isBlank()
                ? "Traffic ingestion is recovering from a provider data gap."
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

    private static CorridorAnalyticsSummaryDto toCorridorSummaryDto(
        TrafficCorridorSummaryProjection row,
        long incidentEventCount
    ) {
        Long incidentObservations = row.getTotalIncidentCount();
        return new CorridorAnalyticsSummaryDto(
            row.getCorridor(),
            row.getBucketCount(),
            row.getSampleCount(),
            row.getAvgCurrentSpeed(),
            row.getMinCurrentSpeed(),
            row.getAvgSpeedStddev(),
            incidentObservations,
            incidentEventCount,
            incidentObservations,
            row.getFirstBucketStart() == null ? null : OffsetDateTime.ofInstant(row.getFirstBucketStart(), ZoneOffset.UTC),
            row.getLastBucketStart() == null ? null : OffsetDateTime.ofInstant(row.getLastBucketStart(), ZoneOffset.UTC)
        );
    }


    private static double roundToSingleDecimal(double value) {
        return Math.round(value * 10.0) / 10.0;
    }


}
