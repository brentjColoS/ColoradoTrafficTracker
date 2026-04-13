package com.example.ingest_service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

@ExtendWith(MockitoExtension.class)
class QuotaPressureHealthIndicatorTest {

    @Mock
    private TileTrafficPoller tileTrafficPoller;

    @Test
    void healthIsOutOfServiceWhenQuotaCritical() {
        TrafficProps props = new TrafficProps("key", 60, "tile", 10, 4, 500, 35_000, 38_000, 40_000);
        when(tileTrafficPoller.quotaSnapshot()).thenReturn(new TileTrafficPoller.QuotaSnapshot(96, 40_000, 45_000, 100));

        QuotaPressureHealthIndicator indicator = new QuotaPressureHealthIndicator(
            props,
            tileTrafficPoller,
            new TrafficObservabilityProps(15, 80, 95)
        );

        assertThat(indicator.health().getStatus().getCode()).isEqualTo("OUT_OF_SERVICE");
    }

    @Test
    void healthIsDegradedWhenQuotaWarnThresholdCrossed() {
        TrafficProps props = new TrafficProps("key", 60, "tile", 10, 4, 500, 35_000, 38_000, 40_000);
        when(tileTrafficPoller.quotaSnapshot()).thenReturn(new TileTrafficPoller.QuotaSnapshot(85, 40_000, 45_000, 100));

        QuotaPressureHealthIndicator indicator = new QuotaPressureHealthIndicator(
            props,
            tileTrafficPoller,
            new TrafficObservabilityProps(15, 80, 95)
        );

        assertThat(indicator.health().getStatus().getCode()).isEqualTo("DEGRADED");
    }

    @Test
    void healthIsUpWhenUsageBelowWarnThreshold() {
        TrafficProps props = new TrafficProps("key", 60, "tile", 10, 4, 500, 35_000, 38_000, 40_000);
        when(tileTrafficPoller.quotaSnapshot()).thenReturn(new TileTrafficPoller.QuotaSnapshot(70, 40_000, 45_000, 100));

        QuotaPressureHealthIndicator indicator = new QuotaPressureHealthIndicator(
            props,
            tileTrafficPoller,
            new TrafficObservabilityProps(15, 80, 95)
        );

        assertThat(indicator.health().getStatus().getCode()).isEqualTo("UP");
    }

    @Test
    void pointModeSkipsQuotaCheck() {
        TrafficProps props = new TrafficProps("key", 60, "point", 10, 4, 500, 35_000, 38_000, 40_000);
        QuotaPressureHealthIndicator indicator = new QuotaPressureHealthIndicator(
            props,
            tileTrafficPoller,
            new TrafficObservabilityProps(15, 80, 95)
        );

        assertThat(indicator.health().getStatus().getCode()).isEqualTo("UP");
        assertThat(indicator.health().getDetails()).containsEntry("mode", "point");
        verifyNoInteractions(tileTrafficPoller);
    }

    @Test
    void healthUsesZeroPercentWhenHardStopMissing() {
        TrafficProps props = new TrafficProps("key", 60, "tile", 10, 4, 500, 35_000, 38_000, 0);
        when(tileTrafficPoller.quotaSnapshot()).thenReturn(new TileTrafficPoller.QuotaSnapshot(2_000, 35_000, 38_000, 0));

        QuotaPressureHealthIndicator indicator = new QuotaPressureHealthIndicator(
            props,
            tileTrafficPoller,
            new TrafficObservabilityProps(15, 80, 95)
        );

        assertThat(indicator.health().getStatus().getCode()).isEqualTo("UP");
        assertThat(indicator.health().getDetails()).containsEntry("usedPercent", "0.00");
    }

    @Test
    void warningAndCriticalThresholdsAreClampedToAtLeastOnePercent() {
        TrafficProps props = new TrafficProps("key", 60, "tile", 10, 4, 500, 35_000, 38_000, 100);
        when(tileTrafficPoller.quotaSnapshot()).thenReturn(new TileTrafficPoller.QuotaSnapshot(1, 35_000, 38_000, 100));

        QuotaPressureHealthIndicator indicator = new QuotaPressureHealthIndicator(
            props,
            tileTrafficPoller,
            new TrafficObservabilityProps(15, 0, 0)
        );

        assertThat(indicator.health().getStatus().getCode()).isEqualTo("OUT_OF_SERVICE");
        assertThat(indicator.health().getDetails()).containsEntry("warnPercent", 1);
        assertThat(indicator.health().getDetails()).containsEntry("criticalPercent", 1);
    }
}
