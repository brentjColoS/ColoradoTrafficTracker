package com.example.ingest_service;

import io.micrometer.core.instrument.Counter;
import io.micrometer.core.instrument.MeterRegistry;
import java.time.LocalDate;
import java.util.List;
import java.util.concurrent.atomic.AtomicLong;

final class TileQuotaUsage {
    private static final String VECTOR_TILE_PRODUCT = TomTomRequestGovernor.VECTOR_TILE_PRODUCT;
    private final TrafficPullProps pullProps;
    private final TomTomAccountQuotaManager quotaManager;
    private final AtomicLong quotaUsedGauge;
    private final AtomicLong quotaHardStopGauge;
    private final Counter quotaBlockedCounter;

    TileQuotaUsage(TrafficPullProps pullProps, TomTomAccountQuotaManager quotaManager, MeterRegistry meterRegistry) {
        this.pullProps = pullProps;
        this.quotaManager = quotaManager;
        this.quotaUsedGauge = meterRegistry.gauge("traffic.tile.quota.used.requests", new AtomicLong(0));
        this.quotaHardStopGauge = meterRegistry.gauge("traffic.tile.quota.hard_stop.requests", new AtomicLong(0));
        this.quotaBlockedCounter = Counter.builder("traffic.tile.quota.blocked.total")
            .description("Count of tile poll cycles blocked by quota")
            .register(meterRegistry);
        this.quotaUsedGauge.set(0);
        this.quotaHardStopGauge.set(config().hardStop());
    }

    void recordBlocked() {
        quotaBlockedCounter.increment();
    }

    record Config(
        int target,
        int adaptiveCap,
        int hardStop,
        int allowance,
        int targetPerAccount,
        int hardStopPerAccount,
        int allowancePerAccount,
        int accountCount
    ) {}
    record Decision(
        boolean allowed,
        long callsReserved,
        long requestsUsed,
        TomTomAccountQuotaManager.AccountReservation reservation
    ) {
        TomTomAccount account() {
            return reservation == null ? null : reservation.account();
        }
    }
    Config config() {
        TrafficPullProps.MonthlyRequestBudget budget = pullProps.monthlyRequestBudget();
        int accountCount = quotaManager.availableAccountCount();
        int targetPerAccount = Math.max(1, budget.targetRequests());
        int hardStopPerAccount = Math.max(targetPerAccount, budget.hardStopRequests());
        int allowancePerAccount = Math.max(hardStopPerAccount, budget.allowanceRequests());
        int target = safeMultiply(targetPerAccount, accountCount);
        int hardStop = safeMultiply(hardStopPerAccount, accountCount);
        int allowance = safeMultiply(allowancePerAccount, accountCount);
        return new Config(
            target,
            target,
            hardStop,
            allowance,
            targetPerAccount,
            hardStopPerAccount,
            allowancePerAccount,
            accountCount
        );
    }

    TileQuotaSnapshot snapshot() {
        Config quota = config();
        List<TomTomAccountQuotaManager.AccountQuotaSnapshot> accounts = quotaManager.snapshots(
            VECTOR_TILE_PRODUCT,
            quota.targetPerAccount(),
            quota.hardStopPerAccount(),
            quota.allowancePerAccount()
        );
        long used = accounts.stream()
            .mapToLong(TomTomAccountQuotaManager.AccountQuotaSnapshot::requestsUsed)
            .sum();
        LocalDate periodStart = accounts.stream()
            .map(TomTomAccountQuotaManager.AccountQuotaSnapshot::periodStart)
            .filter(java.util.Objects::nonNull)
            .findFirst()
            .orElse(null);
        LocalDate periodEnd = accounts.stream()
            .map(TomTomAccountQuotaManager.AccountQuotaSnapshot::periodEnd)
            .filter(java.util.Objects::nonNull)
            .findFirst()
            .orElse(null);
        return new TileQuotaSnapshot(
            used,
            quota.target(),
            quota.adaptiveCap(),
            quota.hardStop(),
            quota.allowance(),
            periodStart,
            periodEnd,
            accounts
        );
    }

    Decision reserve(long requestedCalls, int hardStopPerAccount) {
        java.util.Optional<TomTomAccountQuotaManager.AccountReservation> selected =
            quotaManager.reserveCompleteBatch(
            VECTOR_TILE_PRODUCT,
            requestedCalls,
            hardStopPerAccount
        );
        refresh(config().hardStop());
        if (selected.isEmpty()) {
            return new Decision(false, 0, used(), null);
        }
        TomTomAccountQuotaManager.AccountReservation reservation = selected.get();
        return new Decision(
            true,
            reservation.callsReserved(),
            reservation.requestsUsed(),
            reservation
        );
    }

    void release(
        TomTomAccountQuotaManager.AccountReservation reservation,
        long callsToRelease
    ) {
        if (reservation == null || callsToRelease <= 0) return;
        quotaManager.release(reservation, callsToRelease);
        refresh(config().hardStop());
    }

    long used() {
        Config quota = config();
        return quotaManager.snapshots(
            VECTOR_TILE_PRODUCT,
            quota.targetPerAccount(),
            quota.hardStopPerAccount(),
            quota.allowancePerAccount()
        ).stream()
            .mapToLong(TomTomAccountQuotaManager.AccountQuotaSnapshot::requestsUsed)
            .sum();
    }

    void refresh(int hardStopMonthlyRequests) {
        quotaUsedGauge.set(used());
        quotaHardStopGauge.set(hardStopMonthlyRequests);
    }

    private static int safeMultiply(int value, int multiplier) {
        return (int) Math.min(Integer.MAX_VALUE, Math.max(0L, (long) value * multiplier));
    }

}
