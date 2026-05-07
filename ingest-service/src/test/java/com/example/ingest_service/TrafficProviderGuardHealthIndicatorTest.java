package com.example.ingest_service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.when;

import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.Optional;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.boot.actuate.health.Health;
import org.springframework.boot.actuate.health.Status;

@ExtendWith(MockitoExtension.class)
class TrafficProviderGuardHealthIndicatorTest {

    @Mock
    private TrafficProviderGuardService providerGuardService;

    @Test
    void reportsDegradedWhenProviderStatusIsStale() {
        TrafficProviderGuardStatus status = new TrafficProviderGuardStatus();
        status.setProviderName("tomtom");
        status.setState("HEALTHY");
        status.setHalted(false);
        status.setLastCheckedAt(OffsetDateTime.now(ZoneOffset.UTC).minusMinutes(30));

        when(providerGuardService.statusSnapshot()).thenReturn(Optional.of(status));

        TrafficProviderGuardHealthIndicator indicator = new TrafficProviderGuardHealthIndicator(
            providerGuardService,
            new TrafficObservabilityProps(15, 80, 95, 3, 6, 60)
        );

        Health health = indicator.health();

        assertThat(health.getStatus()).isEqualTo(new Status("DEGRADED"));
        assertThat(health.getDetails()).containsEntry("stale", true);
    }

    @Test
    void reportsUpWhenProviderStatusIsFreshAndHealthy() {
        TrafficProviderGuardStatus status = new TrafficProviderGuardStatus();
        status.setProviderName("tomtom");
        status.setState("HEALTHY");
        status.setHalted(false);
        status.setLastCheckedAt(OffsetDateTime.now(ZoneOffset.UTC).minusMinutes(3));

        when(providerGuardService.statusSnapshot()).thenReturn(Optional.of(status));

        TrafficProviderGuardHealthIndicator indicator = new TrafficProviderGuardHealthIndicator(
            providerGuardService,
            new TrafficObservabilityProps(15, 80, 95, 3, 6, 60)
        );

        Health health = indicator.health();

        assertThat(health.getStatus()).isEqualTo(Status.UP);
        assertThat(health.getDetails()).containsEntry("stale", false);
    }

    @Test
    void reportsDegradedWhenProviderStatusIsRecovering() {
        TrafficProviderGuardStatus status = new TrafficProviderGuardStatus();
        status.setProviderName("tomtom");
        status.setState("RECOVERING");
        status.setHalted(false);
        status.setFailureCode("EMPTY_PAYLOAD_RECOVERING");
        status.setLastCheckedAt(OffsetDateTime.now(ZoneOffset.UTC).minusMinutes(1));

        when(providerGuardService.statusSnapshot()).thenReturn(Optional.of(status));

        TrafficProviderGuardHealthIndicator indicator = new TrafficProviderGuardHealthIndicator(
            providerGuardService,
            new TrafficObservabilityProps(15, 80, 95, 3, 6, 60)
        );

        Health health = indicator.health();

        assertThat(health.getStatus()).isEqualTo(new Status("DEGRADED"));
        assertThat(health.getDetails()).containsEntry("recoverable", true);
    }
}
