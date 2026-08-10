package com.example.ingest_service;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.Map;
import org.junit.jupiter.api.Test;

class IncidentProviderHealthIndicatorTest {

    private static final Clock NOW = Clock.fixed(
        Instant.parse("2026-07-27T18:00:00Z"),
        ZoneOffset.UTC
    );

    @Test
    void reportsProviderFreshnessAndActiveEventCount() {
        IncidentSnapshotStore store = new IncidentSnapshotStore();
        store.replace(Map.of(
            "I25",
            snapshot("I25", "2026-07-27T17:55:00Z", 2),
            "I70",
            snapshot("I70", "2026-07-27T17:58:00Z", 1)
        ));

        var health = indicator(store).health();

        assertThat(health.getStatus().getCode()).isEqualTo("UP");
        assertThat(health.getDetails())
            .containsEntry("provider", "cdot")
            .containsEntry("product", "current-incidents-and-planned-events")
            .containsEntry("snapshotAgeSeconds", 300L)
            .containsEntry("corridorCount", 2)
            .containsEntry("activeIncidentCount", 3);
    }

    @Test
    void degradesWhenTheOldestCorridorSnapshotMissesTwoPollWindows() {
        IncidentSnapshotStore store = new IncidentSnapshotStore();
        store.replace(Map.of("I25", snapshot("I25", "2026-07-27T17:29:59Z", 1)));

        assertThat(indicator(store).health().getStatus().getCode()).isEqualTo("DEGRADED");
    }

    @Test
    void explainsWhenTheFirstSnapshotHasNotArrived() {
        var health = indicator(new IncidentSnapshotStore()).health();

        assertThat(health.getStatus().getCode()).isEqualTo("DEGRADED");
        assertThat(health.getDetails())
            .containsEntry("reason", "Waiting for the first complete incident snapshot");
    }

    private static IncidentProviderHealthIndicator indicator(IncidentSnapshotStore store) {
        return new IncidentProviderHealthIndicator(
            trafficProps(),
            pullProps(),
            store,
            NOW
        );
    }

    private static CorridorIncidentSnapshot snapshot(String corridor, String fetchedAt, int count) {
        Instant fetched = Instant.parse(fetchedAt);
        return new CorridorIncidentSnapshot(
            corridor,
            "cdot",
            "current-incidents-and-planned-events",
            fetched,
            fetched.minusSeconds(60),
            "{\"incidents\":[]}",
            count
        );
    }

    private static TrafficProps trafficProps() {
        return new TrafficProps("key", 60, "tile", 10, "", 4, 500, 35_000, 38_000, 40_000, true);
    }

    private static TrafficPullProps pullProps() {
        return new TrafficPullProps(
            new TrafficPullProps.Flow(true, "tomtom", 125, 10, ""),
            new TrafficPullProps.Incidents(true, "cdot", 900, 9),
            new TrafficPullProps.MonthlyRequestBudget(190_000, 195_000, 200_000)
        );
    }
}
