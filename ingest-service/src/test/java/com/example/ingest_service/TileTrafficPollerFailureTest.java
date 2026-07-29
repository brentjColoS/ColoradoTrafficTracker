package com.example.ingest_service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.intThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import java.util.List;
import java.time.LocalDate;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.web.reactive.function.client.ClientResponse;
import org.springframework.web.reactive.function.client.WebClient;
import org.springframework.web.reactive.function.client.WebClientResponseException;

class TileTrafficPollerFailureTest {

    @Test
    void failedTileCycleStopsFanOutReleasesQuotaAndDoesNotPersistEmptySamples() {
        AtomicInteger issuedRequests = new AtomicInteger();
        WebClient failingClient = WebClient.builder()
            .exchangeFunction(request -> {
                issuedRequests.incrementAndGet();
                return reactor.core.publisher.Mono.just(
                    ClientResponse.create(HttpStatus.FORBIDDEN)
                        .header("Content-Type", "application/json")
                        .body("{\"detailedError\":{\"code\":\"InsufficientFunds\"}}")
                        .build()
                );
            })
            .build();
        TrafficSampleWriter writer = mock(TrafficSampleWriter.class);
        TrafficRequestBudget budget = mock(TrafficRequestBudget.class);
        when(budget.monthlyUsageForAccount(anyString(), anyString(), anyString())).thenReturn(
            new TrafficRequestBudget.MonthlyUsage(
                0,
                LocalDate.of(2026, 7, 1),
                LocalDate.of(2026, 8, 1),
                "tomtom",
                "primary",
                "traffic-flow-incidents-vector-tiles"
            )
        );
        when(budget.reserveMonthlyForAccount(
            anyString(),
            anyString(),
            anyString(),
            anyInt(),
            anyInt()
        )).thenAnswer(invocation ->
            new TrafficRequestBudget.MonthlyReservation(
                true,
                invocation.getArgument(3),
                ((Integer) invocation.getArgument(3)).longValue(),
                invocation.getArgument(4),
                LocalDate.of(2026, 7, 1),
                LocalDate.of(2026, 8, 1),
                invocation.getArgument(0),
                invocation.getArgument(1),
                invocation.getArgument(2)
            )
        );
        TomTomAccountQuotaManager quotaManager = new TomTomAccountQuotaManager(
            new TomTomAccountPool(
                new TrafficProps("key", 120, "tile", 10, "", 1, 500.0, 35_000, 38_000, 40_000, true),
                new TomTomAccountsProps("", false, true)
            ),
            budget
        );
        TrafficProviderGuardService providerGuard = mock(TrafficProviderGuardService.class);
        when(providerGuard.isInsufficientFunds(any(WebClientResponseException.class)))
            .thenReturn(true);

        TileTrafficPoller poller = new TileTrafficPoller(
            failingClient,
            new TrafficProps("key", 120, "tile", 10, "", 1, 500.0, 35_000, 38_000, 40_000, true),
            new TrafficPullProps(
                new TrafficPullProps.Flow(true, "tomtom", 125, 10, ""),
                new TrafficPullProps.Incidents(true, "tomtom", 900, 9),
                new TrafficPullProps.MonthlyRequestBudget(190_000, 195_000, 200_000)
            ),
            writer,
            mock(CorridorGeometryStore.class),
            providerGuard,
            quotaManager,
            mock(TomTomRequestGovernor.class),
            new IncidentSnapshotStore(),
            new SimpleMeterRegistry()
        );
        TrafficProps.Corridor corridor = new TrafficProps.Corridor(
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

        assertThatThrownBy(() -> poller.pollFlowAndPersist(List.of(corridor)))
            .hasMessageContaining("403");
        verify(budget).releaseMonthly(
            org.mockito.ArgumentMatchers.any(TrafficRequestBudget.MonthlyReservation.class),
            intThat(released -> released > 0)
        );
        assertThat(issuedRequests.get()).isEqualTo(1);
        assertThat(quotaManager.firstAccount()).isEmpty();
        verifyNoInteractions(writer);
    }
}
