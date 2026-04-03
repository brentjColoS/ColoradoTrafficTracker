package com.example.ingest_service;

import java.util.Locale;
import org.springframework.boot.actuate.health.Health;
import org.springframework.boot.actuate.health.HealthIndicator;
import org.springframework.boot.actuate.health.Status;
import org.springframework.stereotype.Component;

@Component("quotaPressure")
public class QuotaPressureHealthIndicator implements HealthIndicator {

    private final TrafficProps trafficProps;
    private final TileTrafficPoller tileTrafficPoller;
    private final TrafficObservabilityProps observabilityProps;

    public QuotaPressureHealthIndicator(
        TrafficProps trafficProps,
        TileTrafficPoller tileTrafficPoller,
        TrafficObservabilityProps observabilityProps
    ) {
        this.trafficProps = trafficProps;
        this.tileTrafficPoller = tileTrafficPoller;
        this.observabilityProps = observabilityProps;
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
        double usedPercent = quota.hardStop() <= 0 ? 0.0 : (quota.usedToday() * 100.0) / quota.hardStop();
        int warnPercent = Math.max(1, observabilityProps.quotaWarnPercent());
        int criticalPercent = Math.max(warnPercent, observabilityProps.quotaCriticalPercent());

        Status status = usedPercent >= criticalPercent
            ? Status.OUT_OF_SERVICE
            : (usedPercent >= warnPercent ? new Status("DEGRADED") : Status.UP);

        return Health.status(status)
            .withDetail("mode", "tile")
            .withDetail("usedToday", quota.usedToday())
            .withDetail("targetDailyRequests", quota.target())
            .withDetail("adaptiveCapDailyRequests", quota.adaptiveCap())
            .withDetail("hardStopDailyRequests", quota.hardStop())
            .withDetail("usedPercent", String.format(Locale.US, "%.2f", usedPercent))
            .withDetail("warnPercent", warnPercent)
            .withDetail("criticalPercent", criticalPercent)
            .build();
    }
}
