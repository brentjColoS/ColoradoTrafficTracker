package com.example.ingest_service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import reactor.core.publisher.Mono;

class TrafficIncidentPollerTest {

    @Test
    void publishesOnlyTheConfiguredProviderResult() {
        TrafficProps.Corridor corridor = corridor();
        CorridorIncidentSnapshot snapshot = snapshot("cdot", "current-incidents");
        TrafficIncidentProvider cdot = provider("cdot");
        TrafficIncidentProvider tomtom = provider("tomtom");
        when(cdot.poll(List.of(corridor))).thenReturn(Map.of(corridor.name(), snapshot));

        IncidentSnapshotStore store = new IncidentSnapshotStore();
        TrafficIncidentPoller poller = poller(store, List.of(cdot, tomtom), List.of(corridor));
        poller.pollOnce();

        assertThat(store.latest(corridor.name())).contains(snapshot);
        verify(cdot).poll(List.of(corridor));
        verify(tomtom, never()).poll(org.mockito.ArgumentMatchers.anyList());
    }

    @Test
    void keepsTheLastGoodSnapshotWhenTheProviderFails() {
        CorridorIncidentSnapshot original = snapshot("cdot", "current-incidents");
        IncidentSnapshotStore store = new IncidentSnapshotStore();
        store.replace(Map.of(original.corridor(), original));

        TrafficIncidentProvider cdot = provider("cdot");
        when(cdot.poll(org.mockito.ArgumentMatchers.anyList()))
            .thenThrow(new IllegalStateException("temporary outage"));

        TrafficIncidentPoller poller = poller(store, List.of(cdot), List.of(corridor()));
        poller.pollOnce();

        assertThat(store.latest(original.corridor())).contains(original);
    }

    @Test
    void rejectsPartialProviderResultsBeforePublishingOrPersisting() {
        TrafficProps.Corridor i25 = corridor();
        TrafficProps.Corridor i70 = new TrafficProps.Corridor(
            "I70",
            "Interstate 70",
            "I-70",
            "E",
            "W",
            180.0,
            250.0,
            List.of(),
            "39.70,-105.70,39.80,-104.80",
            "{\"type\":\"LineString\",\"coordinates\":[[-105.7,39.7],[-104.8,39.8]]}",
            null,
            550.0
        );
        TrafficIncidentProvider cdot = provider("cdot");
        when(cdot.poll(List.of(i25, i70))).thenReturn(Map.of("I25", snapshot("cdot", "current-incidents")));
        IncidentEventWriter eventWriter = mock(IncidentEventWriter.class);
        IncidentSnapshotStore store = new IncidentSnapshotStore();

        poller(store, List.of(cdot), List.of(i25, i70), eventWriter).pollOnce();

        assertThat(store.snapshot()).isEmpty();
        verify(eventWriter, never()).publish(org.mockito.ArgumentMatchers.anyMap());
    }

    private static TrafficIncidentPoller poller(
        IncidentSnapshotStore store,
        List<TrafficIncidentProvider> providers,
        List<TrafficProps.Corridor> corridors
    ) {
        return poller(store, providers, corridors, mock(IncidentEventWriter.class));
    }

    private static TrafficIncidentPoller poller(
        IncidentSnapshotStore store,
        List<TrafficIncidentProvider> providers,
        List<TrafficProps.Corridor> corridors,
        IncidentEventWriter eventWriter
    ) {
        RoutesClient routesClient = mock(RoutesClient.class);
        when(routesClient.fetchCorridors()).thenReturn(Mono.just(corridors));

        return new TrafficIncidentPoller(
            trafficProps(),
            new TrafficPullProps(
                new TrafficPullProps.Flow(true, "tomtom", 125, 10, ""),
                new TrafficPullProps.Incidents(true, "cdot", 900, 9),
                new TrafficPullProps.MonthlyRequestBudget(190_000, 195_000, 200_000)
            ),
            routesClient,
            eventWriter,
            store,
            mock(TrafficSchedulerLease.class),
            mock(TrafficProviderGuardService.class),
            providers
        );
    }

    private static TrafficIncidentProvider provider(String name) {
        TrafficIncidentProvider provider = mock(TrafficIncidentProvider.class);
        when(provider.providerName()).thenReturn(name);
        return provider;
    }

    private static CorridorIncidentSnapshot snapshot(String provider, String product) {
        return new CorridorIncidentSnapshot(
            "I25",
            provider,
            product,
            Instant.parse("2026-07-27T18:00:00Z"),
            Instant.parse("2026-07-27T17:58:00Z"),
            "{\"incidents\":[]}",
            0
        );
    }

    private static TrafficProps trafficProps() {
        return new TrafficProps(
            "key",
            60,
            "tile",
            10,
            "",
            2,
            500,
            35_000,
            38_000,
            40_000,
            false
        );
    }

    private static TrafficProps.Corridor corridor() {
        return new TrafficProps.Corridor(
            "I25",
            "Interstate 25",
            "I-25",
            "S",
            "N",
            271.0,
            208.0,
            List.of(),
            "40.61,-105.01,39.69,-104.99",
            "{\"type\":\"LineString\",\"coordinates\":[[-105.0,40.6],[-105.0,39.7]]}",
            null,
            550.0
        );
    }
}
