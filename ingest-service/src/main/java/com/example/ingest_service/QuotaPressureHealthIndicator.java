package com.example.ingest_service;

import java.time.Clock;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.time.temporal.ChronoUnit;
import java.util.Locale;
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

        Status status = usedPercent >= criticalPercent
            ? Status.OUT_OF_SERVICE
            : (
                usedPercent >= warnPercent || projectedMonthEndRequests >= quota.target()
                    ? new Status("DEGRADED")
                    : Status.UP
            );

        return Health.status(status)
            .withDetail("mode", "tile")
            .withDetail("provider", "tomtom")
            .withDetail("product", "traffic-flow-incidents-vector-tiles")
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
            .build();
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
