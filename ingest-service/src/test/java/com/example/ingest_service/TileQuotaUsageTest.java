package com.example.ingest_service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import java.time.LocalDate;
import java.util.List;
import org.junit.jupiter.api.Test;

class TileQuotaUsageTest {
    private final TomTomAccountQuotaManager manager = mock(TomTomAccountQuotaManager.class);
    private final SimpleMeterRegistry registry = new SimpleMeterRegistry();

    @Test
    void snapshotsKeepAccountPeriodsTotalsAndPublicQuotaValues() {
        when(manager.availableAccountCount()).thenReturn(2);
        var period = LocalDate.of(2026, 11, 1);
        var accounts = List.of(
            new TomTomAccountQuotaManager.AccountQuotaSnapshot("primary", 100, 190000, 195000, 200000, period, period.plusMonths(1)),
            new TomTomAccountQuotaManager.AccountQuotaSnapshot("secondary", 20, 190000, 195000, 200000, period, period.plusMonths(1)));
        when(manager.snapshots(anyString(), anyInt(), anyInt(), anyInt())).thenReturn(accounts);
        var usage = new TileQuotaUsage(new TrafficPullProps(null, null, null), manager, registry);

        var snapshot = usage.snapshot();
        usage.refresh(390000);
        usage.recordBlocked();

        assertThat(snapshot.usedThisMonth()).isEqualTo(120);
        assertThat(snapshot.target()).isEqualTo(380000);
        assertThat(snapshot.hardStop()).isEqualTo(390000);
        assertThat(snapshot.allowance()).isEqualTo(400000);
        assertThat(snapshot.periodStart()).isEqualTo(period);
        assertThat(snapshot.periodEnd()).isEqualTo(period.plusMonths(1));
        assertThat(snapshot.accounts()).isEqualTo(accounts);
        assertThat(registry.get("traffic.tile.quota.used.requests").gauge().value()).isEqualTo(120);
        assertThat(registry.get("traffic.tile.quota.hard_stop.requests").gauge().value()).isEqualTo(390000);
        assertThat(registry.get("traffic.tile.quota.blocked.total").counter().count()).isEqualTo(1);
    }

    @Test
    void configurationBoundsStayOrderedAndCombinedTotalsDoNotOverflow() {
        when(manager.availableAccountCount()).thenReturn(Integer.MAX_VALUE);
        var usage = new TileQuotaUsage(new TrafficPullProps(null, null,
            new TrafficPullProps.MonthlyRequestBudget(Integer.MAX_VALUE, 1, 1)), manager, registry);

        assertThat(usage.config().target()).isEqualTo(Integer.MAX_VALUE);
        assertThat(usage.config().hardStop()).isEqualTo(Integer.MAX_VALUE);
        assertThat(usage.config().allowance()).isEqualTo(Integer.MAX_VALUE);
        assertThat(usage.config().hardStopPerAccount()).isEqualTo(Integer.MAX_VALUE);
    }

    @Test
    void releasingAnAbsentOrUnusedReservationDoesNotTouchTheLedger() {
        var usage = new TileQuotaUsage(new TrafficPullProps(null, null, null), manager, registry);
        clearInvocations(manager);

        usage.release(null, 10);
        usage.release(mock(TomTomAccountQuotaManager.AccountReservation.class), 0);

        verifyNoInteractions(manager);
    }
}
