package com.example.ingest_service;

import java.time.Clock;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.time.temporal.ChronoUnit;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.actuate.health.Health;
import org.springframework.boot.actuate.health.HealthIndicator;
import org.springframework.boot.actuate.health.Status;
import org.springframework.stereotype.Component;

@Component("quotaPressure")
public class QuotaPressureHealthIndicator implements HealthIndicator {

    private final TrafficProps trafficProps;
    private final TileTrafficPoller tileTrafficPoller;
    private final TrafficObservabilityProps observabilityProps;
    private final Clock clock;

    @Autowired
    public QuotaPressureHealthIndicator(
        TrafficProps trafficProps,
        TileTrafficPoller tileTrafficPoller,
        TrafficObservabilityProps observabilityProps
    ) {
        this(trafficProps, tileTrafficPoller, observabilityProps, Clock.systemUTC());
    }

    QuotaPressureHealthIndicator(
        TrafficProps trafficProps,
        TileTrafficPoller tileTrafficPoller,
        TrafficObservabilityProps observabilityProps,
        Clock clock
    ) {
        this.trafficProps = trafficProps;
        this.tileTrafficPoller = tileTrafficPoller;
        this.observabilityProps = observabilityProps;
        this.clock = clock;
    }

    @Override
    public Health health() {
        if (!trafficProps.useTileMode()) {
            return Health.up()
                .withDetail("mode", "point")
                .withDetail("reason", "Quota pressure applies only in tile mode")
                .build();
        }

        TileTrafficPoller.QuotaSnapshot quota = tileTrafficPoller.quotaSnapshot();
        double usedPercent = quota.hardStop() <= 0 ? 0.0 : (quota.usedThisMonth() * 100.0) / quota.hardStop();
        long remainingToTarget = remaining(quota.target(), quota.usedThisMonth());
        long remainingToHardStop = remaining(quota.hardStop(), quota.usedThisMonth());
        long remainingInAllowance = remaining(quota.allowance(), quota.usedThisMonth());
        long projectedMonthEndRequests = projectedMonthEndRequests(quota);
        int warnPercent = Math.max(1, observabilityProps.quotaWarnPercent());
        int criticalPercent = Math.max(warnPercent, observabilityProps.quotaCriticalPercent());

        List<Map<String, Object>> accountDetails = accountDetails(
            quota.accounts(),
            warnPercent,
            criticalPercent
        );
        Status status = quota.accounts().isEmpty()
            ? aggregateStatus(
                quota.usedThisMonth(),
                quota.hardStop(),
                usedPercent,
                projectedMonthEndRequests,
                quota.target(),
                warnPercent
            )
            : accountAwareStatus(
                quota.accounts(),
                projectedMonthEndRequests,
                quota.target()
            );

        return Health.status(status)
            .withDetail("mode", "tile")
            .withDetail("provider", "tomtom")
            .withDetail("product", "traffic-flow-incidents-vector-tiles")
            .withDetail("accountSelection", "primary-first-rollover")
            .withDetail("activeAccount", activeAccount(quota.accounts()))
            .withDetail("usedThisMonth", quota.usedThisMonth())
            .withDetail("remainingToTarget", remainingToTarget)
            .withDetail("remainingToHardStop", remainingToHardStop)
            .withDetail("remainingInAllowance", remainingInAllowance)
            .withDetail("projectedMonthEndRequests", projectedMonthEndRequests)
            .withDetail("targetMonthlyRequests", quota.target())
            .withDetail("hardStopMonthlyRequests", quota.hardStop())
            .withDetail("providerAllowanceRequests", quota.allowance())
            .withDetail("periodStart", quota.periodStart())
            .withDetail("resetEstimate", quota.periodEnd())
            .withDetail("usedPercent", String.format(Locale.US, "%.2f", usedPercent))
            .withDetail("warnPercent", warnPercent)
            .withDetail("criticalPercent", criticalPercent)
            .withDetail("configuredAccountCount", quota.accounts().size())
            .withDetail("accounts", accountDetails)
            .build();
    }

    private static String activeAccount(
        List<TomTomAccountQuotaManager.AccountQuotaSnapshot> accounts
    ) {
        return accounts.stream()
            .filter(QuotaPressureHealthIndicator::isAvailable)
            .filter(account -> account.requestsUsed() < account.hardStop())
            .map(TomTomAccountQuotaManager.AccountQuotaSnapshot::accountId)
            .findFirst()
            .orElse(accounts.isEmpty() ? "unconfigured" : "none");
    }

    private Status aggregateStatus(
        long usedThisMonth,
        int hardStop,
        double usedPercent,
        long projectedMonthEndRequests,
        int target,
        int warnPercent
    ) {
        if (hardStop > 0 && usedThisMonth >= hardStop) {
            return Status.OUT_OF_SERVICE;
        }
        if (usedPercent >= warnPercent || projectedMonthEndRequests >= target) {
            return new Status("DEGRADED");
        }
        return Status.UP;
    }

    private Status accountAwareStatus(
        List<TomTomAccountQuotaManager.AccountQuotaSnapshot> accounts,
        long projectedMonthEndRequests,
        int combinedTarget
    ) {
        List<TomTomAccountQuotaManager.AccountQuotaSnapshot> usableAccounts = accounts.stream()
            .filter(QuotaPressureHealthIndicator::isUsable)
            .toList();
        if (usableAccounts.isEmpty()) {
            return Status.OUT_OF_SERVICE;
        }
        if (projectedMonthEndRequests >= combinedTarget) {
            return new Status("DEGRADED");
        }
        return Status.UP;
    }

    private List<Map<String, Object>> accountDetails(
        List<TomTomAccountQuotaManager.AccountQuotaSnapshot> accounts,
        int warnPercent,
        int criticalPercent
    ) {
        return accounts.stream()
            .map(account -> {
                double usedPercent = usedPercent(account);
                String state = isUsable(account)
                    ? (
                        usedPercent >= criticalPercent
                            ? "CRITICAL"
                            : (usedPercent >= warnPercent ? "WARNING" : "HEALTHY")
                    )
                    : accountState(account);
                Map<String, Object> details = new LinkedHashMap<>();
                details.put("accountId", account.accountId());
                details.put("state", state);
                details.put("availability", account.availability());
                details.put("usedThisMonth", account.requestsUsed());
                details.put("remainingToTarget", remaining(account.target(), account.requestsUsed()));
                details.put("remainingToHardStop", remaining(account.hardStop(), account.requestsUsed()));
                details.put("remainingInAllowance", remaining(account.allowance(), account.requestsUsed()));
                details.put("targetMonthlyRequests", account.target());
                details.put("hardStopMonthlyRequests", account.hardStop());
                details.put("providerAllowanceRequests", account.allowance());
                details.put("usedPercent", String.format(Locale.US, "%.2f", usedPercent));
                details.put("periodStart", account.periodStart());
                details.put("resetEstimate", account.periodEnd());
                if (account.retryOn() != null) {
                    details.put("retryOn", account.retryOn());
                }
                return Map.copyOf(details);
            })
            .toList();
    }

    private static double usedPercent(TomTomAccountQuotaManager.AccountQuotaSnapshot account) {
        return account.hardStop() <= 0
            ? 0.0
            : (account.requestsUsed() * 100.0) / account.hardStop();
    }

    private static boolean isAvailable(TomTomAccountQuotaManager.AccountQuotaSnapshot account) {
        return TomTomAccountAvailability.State.AVAILABLE.name().equals(account.availability());
    }

    private static boolean isUsable(TomTomAccountQuotaManager.AccountQuotaSnapshot account) {
        return isAvailable(account) && account.requestsUsed() < account.hardStop();
    }

    private static String accountState(TomTomAccountQuotaManager.AccountQuotaSnapshot account) {
        return isAvailable(account) ? "HARD_STOP_REACHED" : account.availability();
    }

    private long projectedMonthEndRequests(TileTrafficPoller.QuotaSnapshot quota) {
        if (quota.periodStart() == null || quota.periodEnd() == null) {
            return quota.usedThisMonth();
        }

        long daysInPeriod = Math.max(1, ChronoUnit.DAYS.between(quota.periodStart(), quota.periodEnd()));
        LocalDate today = LocalDate.now(clock.withZone(ZoneOffset.UTC));
        LocalDate effectiveDay = today.isBefore(quota.periodStart())
            ? quota.periodStart()
            : (today.isBefore(quota.periodEnd()) ? today : quota.periodEnd().minusDays(1));
        long elapsedDays = Math.max(1, ChronoUnit.DAYS.between(quota.periodStart(), effectiveDay) + 1);
        return (long) Math.ceil((double) quota.usedThisMonth() * daysInPeriod / elapsedDays);
    }

    private static long remaining(int limit, long used) {
        return Math.max(0, (long) limit - used);
    }
}
