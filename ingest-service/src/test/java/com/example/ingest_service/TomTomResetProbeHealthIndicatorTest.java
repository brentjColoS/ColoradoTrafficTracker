package com.example.ingest_service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import org.junit.jupiter.api.Test;
import org.springframework.boot.actuate.health.Health;
import org.springframework.boot.actuate.health.Status;

class TomTomResetProbeHealthIndicatorTest {

    @Test
    void reportsADormantAccountAsWaitingBeforeTheFirstProbe() {
        Fixture fixture = fixture();

        Health health = fixture.indicator().health();

        assertThat(health.getStatus()).isEqualTo(new Status("DEGRADED"));
        assertThat(health.getDetails())
            .containsEntry("purpose", "credit-exhaustion-recovery")
            .containsEntry("resetDetectionCapable", false)
            .containsEntry("dailySchedulerObserved", false)
            .containsEntry("awaitingReset", true);
        assertThat(accountDetails(health))
            .filteredOn(detail -> detail.get("accountId").equals("secondary"))
            .singleElement()
            .satisfies(detail -> assertThat(detail)
                .containsEntry("pollingEnabled", false)
                .containsEntry("awaitingReset", true)
                .containsEntry("probeEligible", true)
                .containsEntry("eligibilityReason", "dormant_account_awaiting_availability")
                .doesNotContainKey("apiKey"));
    }

    @Test
    void reportsHealthyAfterAvailabilityIsObserved() {
        Fixture fixture = fixture();
        when(fixture.history().latest("secondary")).thenReturn(Optional.of(
            new TomTomResetProbeEvent(
                2,
                "secondary",
                Instant.parse("2026-08-01T04:17:00Z"),
                TomTomResetProbeOutcome.AVAILABLE,
                200,
                null
            )
        ));

        Health health = fixture.indicator().health();

        assertThat(health.getStatus()).isEqualTo(Status.UP);
        assertThat(health.getDetails()).containsEntry("awaitingReset", false);
    }

    @Test
    void reportsTheLastSchedulerRunEvenWhenNoProviderCallWasEligible() {
        Fixture fixture = fixture();
        when(fixture.history().latestRun()).thenReturn(Optional.of(
            new TomTomResetProbeRun(
                4,
                Instant.parse("2026-08-02T04:17:00Z"),
                0,
                0
            )
        ));

        Health health = fixture.indicator().health();

        assertThat(health.getDetails())
            .containsEntry("dailySchedulerObserved", true)
            .containsEntry("lastSchedulerRunAt", Instant.parse("2026-08-02T04:17:00Z"))
            .containsEntry("lastEligibleAccountCount", 0)
            .containsEntry("lastAttemptedAccountCount", 0);
    }

    private static Fixture fixture() {
        TomTomAccountsProps props = new TomTomAccountsProps("secondary-key", false, true);
        TomTomAccountPool pool = new TomTomAccountPool(
            new TrafficProps("primary-key", 60, "tile", 10, "", 2, 500, 0, 0, 0, true),
            props
        );
        TomTomAccountAvailability availability = new TomTomAccountAvailability(pool);
        TomTomResetProbeHistory history = mock(TomTomResetProbeHistory.class);
        when(history.latest("primary")).thenReturn(Optional.empty());
        when(history.latest("secondary")).thenReturn(Optional.empty());
        return new Fixture(
            new TomTomResetProbeHealthIndicator(pool, props, availability, history),
            history
        );
    }

    @SuppressWarnings("unchecked")
    private static List<Map<String, Object>> accountDetails(Health health) {
        return (List<Map<String, Object>>) health.getDetails().get("accounts");
    }

    private record Fixture(
        TomTomResetProbeHealthIndicator indicator,
        TomTomResetProbeHistory history
    ) {}
}
