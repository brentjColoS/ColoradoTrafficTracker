package com.example.ingest_service;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;
import org.springframework.boot.actuate.health.Health;
import org.springframework.boot.actuate.health.Status;

class TimeseriesOptimizationHealthIndicatorTest {

    @Test
    void reportsUpWhenOptimizationIsDisabled() {
        TimeseriesOptimizationHealthIndicator indicator = new TimeseriesOptimizationHealthIndicator(
            statusService(new TimeseriesOptimizationStatus(
                false,
                false,
                false,
                false,
                false,
                false,
                false,
                "disabled",
                "disabled"
            ))
        );

        Health health = indicator.health();

        assertThat(health.getStatus()).isEqualTo(Status.UP);
        assertThat(health.getDetails()).containsEntry("enabled", false);
    }

    @Test
    void reportsDegradedWhenOptimizationFailsOnTimescale() {
        TimeseriesOptimizationHealthIndicator indicator = new TimeseriesOptimizationHealthIndicator(
            statusService(new TimeseriesOptimizationStatus(
                true,
                true,
                true,
                false,
                true,
                false,
                false,
                "PostgreSQL 16 with TimescaleDB",
                "failure"
            ))
        );

        Health health = indicator.health();

        assertThat(health.getStatus()).isEqualTo(new Status("DEGRADED"));
        assertThat(health.getDetails()).containsEntry("optimized", false);
    }

    private static TimeseriesOptimizationService statusService(TimeseriesOptimizationStatus status) {
        return new TimeseriesOptimizationService(null, new TrafficTimeseriesProps(false, false, false, false, 7)) {
            @Override
            public TimeseriesOptimizationStatus statusSnapshot() {
                return status;
            }
        };
    }
}
