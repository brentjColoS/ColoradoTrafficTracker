package com.example.ingest_service;

import org.springframework.boot.actuate.health.Health;
import org.springframework.boot.actuate.health.HealthIndicator;
import org.springframework.boot.actuate.health.Status;
import org.springframework.stereotype.Component;

@Component("timeseriesOptimization")
public class TimeseriesOptimizationHealthIndicator implements HealthIndicator {
    private final TimeseriesOptimizationService timeseriesOptimizationService;

    public TimeseriesOptimizationHealthIndicator(TimeseriesOptimizationService timeseriesOptimizationService) {
        this.timeseriesOptimizationService = timeseriesOptimizationService;
    }

    @Override
    public Health health() {
        TimeseriesOptimizationStatus status = timeseriesOptimizationService.statusSnapshot();

        Status healthStatus;
        if (!status.enabled() || !status.postgresCompatible() || !status.timescaleAvailable()) {
            healthStatus = Status.UP;
        } else if (status.optimized()) {
            healthStatus = Status.UP;
        } else {
            healthStatus = new Status("DEGRADED");
        }

        return Health.status(healthStatus)
            .withDetail("enabled", status.enabled())
            .withDetail("postgresCompatible", status.postgresCompatible())
            .withDetail("timescaleAvailable", status.timescaleAvailable())
            .withDetail("optimized", status.optimized())
            .withDetail("hypertablesConfigured", status.hypertablesConfigured())
            .withDetail("compressionConfigured", status.compressionConfigured())
            .withDetail("continuousAggregatesConfigured", status.continuousAggregatesConfigured())
            .withDetail("databaseVersion", status.databaseVersion())
            .withDetail("message", status.message())
            .build();
    }
}
