package com.example.ingest_service;

import java.util.Optional;
import org.springframework.boot.actuate.health.Health;
import org.springframework.boot.actuate.health.HealthIndicator;
import org.springframework.stereotype.Component;

@Component("providerGuard")
public class TrafficProviderGuardHealthIndicator implements HealthIndicator {

    private final TrafficProviderGuardService providerGuardService;

    public TrafficProviderGuardHealthIndicator(TrafficProviderGuardService providerGuardService) {
        this.providerGuardService = providerGuardService;
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
        Health.Builder builder;
        if (status.isHalted()) {
            builder = Health.outOfService();
        } else if ("DEGRADED".equalsIgnoreCase(status.getState())) {
            builder = Health.status("DEGRADED");
        } else if ("HEALTHY".equalsIgnoreCase(status.getState())) {
            builder = Health.up();
        } else {
            builder = Health.unknown();
        }

        return builder
            .withDetail("provider", status.getProviderName())
            .withDetail("state", status.getState())
            .withDetail("halted", status.isHalted())
            .withDetail("failureCode", status.getFailureCode() == null ? "" : status.getFailureCode())
            .withDetail("message", status.getMessage() == null ? "" : status.getMessage())
            .withDetail("consecutiveNullCycles", status.getConsecutiveNullCycles())
            .withDetail("lastCheckedAt", status.getLastCheckedAt())
            .withDetail("lastSuccessAt", status.getLastSuccessAt())
            .withDetail("lastFailureAt", status.getLastFailureAt())
            .withDetail("shutdownTriggeredAt", status.getShutdownTriggeredAt())
            .build();
    }
}
