package com.example.ingest_service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Map;
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
        TrafficProps props = new TrafficProps("key", 60, "tile", 10, "", 4, 500, 35_000, 38_000, 40_000, true);
        when(tileTrafficPoller.quotaSnapshot()).thenReturn(quota(96, 40_000, 45_000, 100));

        QuotaPressureHealthIndicator indicator = new QuotaPressureHealthIndicator(
            props,
            tileTrafficPoller,
            new TrafficObservabilityProps(15, 80, 95, 3, 6, 60)
        );

        assertThat(indicator.health().getStatus().getCode()).isEqualTo("OUT_OF_SERVICE");
    }

    @Test
    void healthIsDegradedWhenQuotaWarnThresholdCrossed() {
        TrafficProps props = new TrafficProps("key", 60, "tile", 10, "", 4, 500, 35_000, 38_000, 40_000, true);
        when(tileTrafficPoller.quotaSnapshot()).thenReturn(quota(85, 40_000, 45_000, 100));

        QuotaPressureHealthIndicator indicator = new QuotaPressureHealthIndicator(
            props,
            tileTrafficPoller,
            new TrafficObservabilityProps(15, 80, 95, 3, 6, 60)
        );

        assertThat(indicator.health().getStatus().getCode()).isEqualTo("DEGRADED");
    }

    @Test
    void healthIsUpWhenUsageBelowWarnThreshold() {
        TrafficProps props = new TrafficProps("key", 60, "tile", 10, "", 4, 500, 35_000, 38_000, 40_000, true);
        when(tileTrafficPoller.quotaSnapshot()).thenReturn(quota(70, 100, 100, 100));

        QuotaPressureHealthIndicator indicator = new QuotaPressureHealthIndicator(
            props,
            tileTrafficPoller,
            new TrafficObservabilityProps(15, 80, 95, 3, 6, 60)
        );

        assertThat(indicator.health().getStatus().getCode()).isEqualTo("UP");
    }

    @Test
    void pointModeSkipsQuotaCheck() {
        TrafficProps props = new TrafficProps("key", 60, "point", 10, "", 4, 500, 35_000, 38_000, 40_000, true);
        QuotaPressureHealthIndicator indicator = new QuotaPressureHealthIndicator(
            props,
            tileTrafficPoller,
            new TrafficObservabilityProps(15, 80, 95, 3, 6, 60)
        );

        assertThat(indicator.health().getStatus().getCode()).isEqualTo("UP");
        assertThat(indicator.health().getDetails()).containsEntry("mode", "point");
        verifyNoInteractions(tileTrafficPoller);
    }

    @Test
    void healthUsesZeroPercentWhenHardStopMissing() {
        TrafficProps props = new TrafficProps("key", 60, "tile", 10, "", 4, 500, 35_000, 38_000, 0, true);
        when(tileTrafficPoller.quotaSnapshot()).thenReturn(quota(2_000, 35_000, 38_000, 0));

        QuotaPressureHealthIndicator indicator = new QuotaPressureHealthIndicator(
            props,
            tileTrafficPoller,
            new TrafficObservabilityProps(15, 80, 95, 3, 6, 60)
        );

        assertThat(indicator.health().getStatus().getCode()).isEqualTo("UP");
        assertThat(indicator.health().getDetails()).containsEntry("usedPercent", "0.00");
    }

    @Test
    void warningAndCriticalThresholdsAreClampedToAtLeastOnePercent() {
        TrafficProps props = new TrafficProps("key", 60, "tile", 10, "", 4, 500, 35_000, 38_000, 100, true);
        when(tileTrafficPoller.quotaSnapshot()).thenReturn(quota(1, 35_000, 38_000, 100));

        QuotaPressureHealthIndicator indicator = new QuotaPressureHealthIndicator(
            props,
            tileTrafficPoller,
            new TrafficObservabilityProps(15, 0, 0, 3, 6, 60)
        );

        assertThat(indicator.health().getStatus().getCode()).isEqualTo("OUT_OF_SERVICE");
        assertThat(indicator.health().getDetails()).containsEntry("warnPercent", 1);
        assertThat(indicator.health().getDetails()).containsEntry("criticalPercent", 1);
    }

    @Test
    void healthProjectsBurnAcrossTheExactCalendarMonth() {
        TrafficProps props = new TrafficProps("key", 60, "tile", 10, "", 4, 500, 35_000, 38_000, 40_000, true);
        LocalDate start = LocalDate.of(2026, 4, 1);
        when(tileTrafficPoller.quotaSnapshot()).thenReturn(
            new TileTrafficPoller.QuotaSnapshot(60_000, 190_000, 190_000, 195_000, 200_000, start, start.plusMonths(1))
        );
        QuotaPressureHealthIndicator indicator = new QuotaPressureHealthIndicator(
            props,
            tileTrafficPoller,
            new TrafficObservabilityProps(15, 80, 95, 3, 6, 60),
            Clock.fixed(Instant.parse("2026-04-10T12:00:00Z"), ZoneOffset.UTC)
        );

        assertThat(indicator.health().getStatus().getCode()).isEqualTo("UP");
        assertThat(indicator.health().getDetails())
            .containsEntry("projectedMonthEndRequests", 180_000L)
            .containsEntry("remainingToTarget", 130_000L)
            .containsEntry("remainingToHardStop", 135_000L)
            .containsEntry("remainingInAllowance", 140_000L)
            .containsEntry("resetEstimate", LocalDate.of(2026, 5, 1));
    }

    @Test
    void healthDegradesBeforeTheLimitWhenProjectedUseExceedsTheTarget() {
        TrafficProps props = new TrafficProps("key", 60, "tile", 10, "", 4, 500, 35_000, 38_000, 40_000, true);
        LocalDate start = LocalDate.of(2026, 7, 1);
        when(tileTrafficPoller.quotaSnapshot()).thenReturn(
            new TileTrafficPoller.QuotaSnapshot(70_000, 190_000, 190_000, 195_000, 200_000, start, start.plusMonths(1))
        );
        QuotaPressureHealthIndicator indicator = new QuotaPressureHealthIndicator(
            props,
            tileTrafficPoller,
            new TrafficObservabilityProps(15, 80, 95, 3, 6, 60),
            Clock.fixed(Instant.parse("2026-07-10T12:00:00Z"), ZoneOffset.UTC)
        );

        assertThat(indicator.health().getStatus().getCode()).isEqualTo("DEGRADED");
        assertThat(indicator.health().getDetails()).containsEntry("projectedMonthEndRequests", 217_000L);
    }

    @Test
    void healthShowsEachAccountWithoutTreatingOneCriticalAccountAsAFullOutage() {
        TrafficProps props = new TrafficProps("key", 60, "tile", 10, "", 4, 500, 35_000, 38_000, 40_000, true);
        LocalDate start = LocalDate.of(2026, 7, 1);
        List<TomTomAccountQuotaManager.AccountQuotaSnapshot> accounts = List.of(
            new TomTomAccountQuotaManager.AccountQuotaSnapshot(
                "primary",
                190_000,
                190_000,
                195_000,
                200_000,
                start,
                start.plusMonths(1)
            ),
            new TomTomAccountQuotaManager.AccountQuotaSnapshot(
                "secondary",
                10_000,
                190_000,
                195_000,
                200_000,
                start,
                start.plusMonths(1)
            )
        );
        when(tileTrafficPoller.quotaSnapshot()).thenReturn(
            new TileTrafficPoller.QuotaSnapshot(
                200_000,
                380_000,
                380_000,
                390_000,
                400_000,
                start,
                start.plusMonths(1),
                accounts
            )
        );
        QuotaPressureHealthIndicator indicator = new QuotaPressureHealthIndicator(
            props,
            tileTrafficPoller,
            new TrafficObservabilityProps(15, 80, 95, 3, 6, 60),
            Clock.fixed(Instant.parse("2026-07-28T12:00:00Z"), ZoneOffset.UTC)
        );

        var health = indicator.health();

        assertThat(health.getStatus().getCode()).isEqualTo("DEGRADED");
        assertThat(health.getDetails()).containsEntry("configuredAccountCount", 2);
        @SuppressWarnings("unchecked")
        List<Map<String, Object>> accountDetails =
            (List<Map<String, Object>>) health.getDetails().get("accounts");
        assertThat(accountDetails)
            .extracting(details -> details.get("accountId"))
            .containsExactly("primary", "secondary");
        assertThat(accountDetails.get(0))
            .containsEntry("state", "CRITICAL")
            .doesNotContainKey("apiKey");
        assertThat(accountDetails.get(1)).containsEntry("state", "HEALTHY");
    }

    @Test
    void healthIsOutOfServiceOnlyWhenEveryConfiguredAccountIsCritical() {
        TrafficProps props = new TrafficProps("key", 60, "tile", 10, "", 4, 500, 35_000, 38_000, 40_000, true);
        LocalDate start = LocalDate.of(2026, 7, 1);
        List<TomTomAccountQuotaManager.AccountQuotaSnapshot> accounts = List.of(
            new TomTomAccountQuotaManager.AccountQuotaSnapshot(
                "primary", 190_000, 190_000, 195_000, 200_000, start, start.plusMonths(1)
            ),
            new TomTomAccountQuotaManager.AccountQuotaSnapshot(
                "secondary", 190_000, 190_000, 195_000, 200_000, start, start.plusMonths(1)
            )
        );
        when(tileTrafficPoller.quotaSnapshot()).thenReturn(
            new TileTrafficPoller.QuotaSnapshot(
                380_000,
                380_000,
                380_000,
                390_000,
                400_000,
                start,
                start.plusMonths(1),
                accounts
            )
        );
        QuotaPressureHealthIndicator indicator = new QuotaPressureHealthIndicator(
            props,
            tileTrafficPoller,
            new TrafficObservabilityProps(15, 80, 95, 3, 6, 60)
        );

        assertThat(indicator.health().getStatus()).isEqualTo(org.springframework.boot.actuate.health.Status.OUT_OF_SERVICE);
    }

    @Test
    void healthReportsAQuarantinedAccountAndItsRetryDate() {
        TrafficProps props = new TrafficProps("key", 60, "tile", 10, "", 4, 500, 35_000, 38_000, 40_000, true);
        LocalDate start = LocalDate.of(2026, 7, 1);
        List<TomTomAccountQuotaManager.AccountQuotaSnapshot> accounts = List.of(
            new TomTomAccountQuotaManager.AccountQuotaSnapshot(
                "primary",
                20_000,
                190_000,
                195_000,
                200_000,
                start,
                start.plusMonths(1),
                "CREDITS_EXHAUSTED",
                LocalDate.of(2026, 8, 1)
            ),
            new TomTomAccountQuotaManager.AccountQuotaSnapshot(
                "secondary",
                10_000,
                190_000,
                195_000,
                200_000,
                start,
                start.plusMonths(1)
            )
        );
        when(tileTrafficPoller.quotaSnapshot()).thenReturn(
            new TileTrafficPoller.QuotaSnapshot(
                30_000,
                190_000,
                190_000,
                195_000,
                200_000,
                start,
                start.plusMonths(1),
                accounts
            )
        );
        QuotaPressureHealthIndicator indicator = new QuotaPressureHealthIndicator(
            props,
            tileTrafficPoller,
            new TrafficObservabilityProps(15, 80, 95, 3, 6, 60)
        );

        var health = indicator.health();

        assertThat(health.getStatus().getCode()).isEqualTo("DEGRADED");
        @SuppressWarnings("unchecked")
        List<Map<String, Object>> details =
            (List<Map<String, Object>>) health.getDetails().get("accounts");
        assertThat(details.get(0))
            .containsEntry("state", "CREDITS_EXHAUSTED")
            .containsEntry("retryOn", LocalDate.of(2026, 8, 1));
        assertThat(details.get(1)).containsEntry("state", "HEALTHY");
    }

    private static TileTrafficPoller.QuotaSnapshot quota(long used, int target, int adaptiveCap, int hardStop) {
        LocalDate today = LocalDate.now(ZoneOffset.UTC);
        return new TileTrafficPoller.QuotaSnapshot(
            used,
            target,
            adaptiveCap,
            hardStop,
            Math.max(hardStop, 200_000),
            today,
            today.plusDays(1)
        );
    }
}
