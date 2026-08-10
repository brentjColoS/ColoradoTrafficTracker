package com.example.ingest_service;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.Comparator;
import java.util.Map;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.actuate.health.Health;
import org.springframework.boot.actuate.health.HealthIndicator;
import org.springframework.boot.actuate.health.Status;
import org.springframework.stereotype.Component;

@Component("incidentProvider")
public class IncidentProviderHealthIndicator implements HealthIndicator {

    private final TrafficProps trafficProps;
    private final TrafficPullProps pullProps;
    private final IncidentSnapshotStore snapshotStore;
    private final Clock clock;

    @Autowired
    public IncidentProviderHealthIndicator(
        TrafficProps trafficProps,
        TrafficPullProps pullProps,
        IncidentSnapshotStore snapshotStore
    ) {
        this(trafficProps, pullProps, snapshotStore, Clock.systemUTC());
    }

    IncidentProviderHealthIndicator(
        TrafficProps trafficProps,
        TrafficPullProps pullProps,
        IncidentSnapshotStore snapshotStore,
        Clock clock
    ) {
        this.trafficProps = trafficProps;
        this.pullProps = pullProps;
        this.snapshotStore = snapshotStore;
        this.clock = clock;
    }

    @Override
    public Health health() {
        TrafficPullProps.Incidents config = pullProps.incidents();
        if (!trafficProps.useTileMode()) {
            return Health.up()
                .withDetail("mode", "point")
                .withDetail("reason", "Incidents are coupled to the legacy point poller")
                .build();
        }
        if (!config.enabled()) {
            return Health.up()
                .withDetail("enabled", false)
                .withDetail("provider", config.provider())
                .build();
        }

        Map<String, CorridorIncidentSnapshot> snapshots = snapshotStore.snapshot();
        if (snapshots.isEmpty()) {
            return Health.status(new Status("DEGRADED"))
                .withDetail("enabled", true)
                .withDetail("provider", config.provider())
                .withDetail("requestedCadenceSeconds", config.pollSeconds())
                .withDetail("reason", "Waiting for the first complete incident snapshot")
                .build();
        }

        Instant oldestFetch = snapshots.values().stream()
            .map(CorridorIncidentSnapshot::fetchedAt)
            .min(Comparator.naturalOrder())
            .orElse(Instant.now(clock));
        Instant newestSourceUpdate = snapshots.values().stream()
            .map(CorridorIncidentSnapshot::sourceUpdatedAt)
            .filter(value -> value != null)
            .max(Comparator.naturalOrder())
            .orElse(null);
        long ageSeconds = Math.max(
            0,
            Duration.between(oldestFetch, Instant.now(clock.withZone(ZoneOffset.UTC))).toSeconds()
        );
        long staleAfterSeconds = Math.max(60, Math.max(1, config.pollSeconds()) * 2L);
        int incidentCount = snapshots.values().stream()
            .mapToInt(CorridorIncidentSnapshot::incidentCount)
            .sum();
        Status status = ageSeconds > staleAfterSeconds ? new Status("DEGRADED") : Status.UP;

        Health.Builder health = Health.status(status)
            .withDetail("enabled", true)
            .withDetail("provider", config.provider())
            .withDetail("product", snapshots.values().iterator().next().product())
            .withDetail("requestedCadenceSeconds", config.pollSeconds())
            .withDetail("staleAfterSeconds", staleAfterSeconds)
            .withDetail("oldestFetchedAt", oldestFetch)
            .withDetail("snapshotAgeSeconds", ageSeconds)
            .withDetail("corridorCount", snapshots.size())
            .withDetail("activeIncidentCount", incidentCount);
        if (newestSourceUpdate != null) {
            health.withDetail("newestSourceUpdatedAt", newestSourceUpdate);
        }
        return health.build();
    }
}
