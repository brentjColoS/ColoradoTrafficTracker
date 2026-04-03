package com.example.ingest_service;

import static org.assertj.core.api.Assertions.assertThat;
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
        TrafficProps props = new TrafficProps("key", 60, "tile", 10, 4, 500);
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
        TrafficProps props = new TrafficProps("key", 60, "tile", 10, 4, 500);
        when(tileTrafficPoller.quotaSnapshot()).thenReturn(new TileTrafficPoller.QuotaSnapshot(85, 40_000, 45_000, 100));

        QuotaPressureHealthIndicator indicator = new QuotaPressureHealthIndicator(
            props,
            tileTrafficPoller,
            new TrafficObservabilityProps(15, 80, 95)
        );

        assertThat(indicator.health().getStatus().getCode()).isEqualTo("DEGRADED");
    }
}
