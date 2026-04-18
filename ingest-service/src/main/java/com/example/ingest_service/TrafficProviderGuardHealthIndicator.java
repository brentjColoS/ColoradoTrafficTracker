package com.example.ingest_service;

import java.time.Duration;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.Optional;
import org.springframework.boot.actuate.health.Health;
import org.springframework.boot.actuate.health.HealthIndicator;
import org.springframework.stereotype.Component;

@Component("providerGuard")
public class TrafficProviderGuardHealthIndicator implements HealthIndicator {

    private final TrafficProviderGuardService providerGuardService;
    private final TrafficObservabilityProps observabilityProps;

    public TrafficProviderGuardHealthIndicator(
        TrafficProviderGuardService providerGuardService,
        TrafficObservabilityProps observabilityProps
    ) {
        this.providerGuardService = providerGuardService;
        this.observabilityProps = observabilityProps;
    }

    @Override
    public Health health() {
        Optional<TrafficProviderGuardStatus> statusOptional = providerGuardService.statusSnapshot();
        if (statusOptional.isEmpty()) {
            return Health.unknown()
                .withDetail("reason", "No provider guard status has been recorded yet")
                .build();
        }

        TrafficProviderGuardStatus status = statusOptional.get();
        Freshness freshness = freshness(status.getLastCheckedAt());
        Health.Builder builder;
        if (status.isHalted()) {
            builder = Health.outOfService();
        } else if (freshness.stale()) {
            builder = Health.status("DEGRADED");
        } else if ("DEGRADED".equalsIgnoreCase(status.getState())) {
            builder = Health.status("DEGRADED");
        } else if ("HEALTHY".equalsIgnoreCase(status.getState())) {
            builder = Health.up();
        } else {
            builder = Health.unknown();
        }

        Health.Builder detailed = builder
            .withDetail("provider", status.getProviderName())
            .withDetail("state", status.getState())
            .withDetail("halted", status.isHalted())
            .withDetail("failureCode", status.getFailureCode() == null ? "" : status.getFailureCode())
            .withDetail("message", status.getMessage() == null ? "" : status.getMessage())
            .withDetail("consecutiveNullCycles", status.getConsecutiveNullCycles())
            .withDetail("stale", freshness.stale());
        if (freshness.ageMinutes() != null) {
            detailed.withDetail("statusAgeMinutes", freshness.ageMinutes());
        }
        addDetailIfPresent(detailed, "lastCheckedAt", status.getLastCheckedAt());
        addDetailIfPresent(detailed, "lastSuccessAt", status.getLastSuccessAt());
        addDetailIfPresent(detailed, "lastFailureAt", status.getLastFailureAt());
        addDetailIfPresent(detailed, "shutdownTriggeredAt", status.getShutdownTriggeredAt());
        return detailed.build();
    }

    private void addDetailIfPresent(Health.Builder builder, String key, Object value) {
        if (value != null) {
            builder.withDetail(key, value);
        }
    }

    private Freshness freshness(OffsetDateTime lastCheckedAt) {
        if (lastCheckedAt == null) {
            return new Freshness(null, false);
        }

        int ageMinutes = (int) Math.max(
            0,
            Duration.between(lastCheckedAt, OffsetDateTime.now(ZoneOffset.UTC)).toMinutes()
        );
        int staleAfterMinutes = Math.max(5, observabilityProps.ingestGapMinutes());
        return new Freshness(ageMinutes, ageMinutes >= staleAfterMinutes);
    }

    private record Freshness(Integer ageMinutes, boolean stale) {}
}
