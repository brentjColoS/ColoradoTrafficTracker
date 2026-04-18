package com.example.api_service;

import com.example.api_service.dto.TrafficProviderGuardStatusDto;
import java.time.Duration;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.Optional;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping({"/api/system", "/dashboard-api/system"})
public class TrafficProviderGuardController {

    private static final String PROVIDER_NAME = "tomtom";

    private final ObjectProvider<TrafficProviderGuardStatusRepository> statusRepositoryProvider;
    private final DashboardProps dashboardProps;

    public TrafficProviderGuardController(
        ObjectProvider<TrafficProviderGuardStatusRepository> statusRepositoryProvider,
        DashboardProps dashboardProps
    ) {
        this.statusRepositoryProvider = statusRepositoryProvider;
        this.dashboardProps = dashboardProps;
    }

    @GetMapping("/provider-status")
    public ResponseEntity<TrafficProviderGuardStatusDto> providerStatus() {
        TrafficProviderGuardStatusRepository statusRepository = statusRepositoryProvider.getIfAvailable();
        TrafficProviderGuardStatus status = Optional.ofNullable(statusRepository)
            .flatMap(repository -> repository.findById(PROVIDER_NAME))
            .orElse(null);
        if (status == null) {
            return ResponseEntity.ok(new TrafficProviderGuardStatusDto(
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
            ));
        }

        FreshnessAssessment freshness = freshness(status.getLastCheckedAt());

        return ResponseEntity.ok(new TrafficProviderGuardStatusDto(
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
        ));
    }

    private FreshnessAssessment freshness(OffsetDateTime lastCheckedAt) {
        if (lastCheckedAt == null) {
            return new FreshnessAssessment(null, "UNKNOWN", false);
        }

        int ageMinutes = (int) Math.max(
            0,
            Duration.between(lastCheckedAt, OffsetDateTime.now(ZoneOffset.UTC)).toMinutes()
        );
        int staleAfterMinutes = Math.max(5, dashboardProps.providerStatusStaleAfterMinutes());
        boolean stale = ageMinutes >= staleAfterMinutes;
        return new FreshnessAssessment(ageMinutes, stale ? "STALE" : "FRESH", stale);
    }

    private record FreshnessAssessment(
        Integer statusAgeMinutes,
        String freshnessState,
        boolean stale
    ) {}
}
