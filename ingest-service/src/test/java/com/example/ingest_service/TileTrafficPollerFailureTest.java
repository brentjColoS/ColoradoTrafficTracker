package com.example.ingest_service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.intThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import java.util.List;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.web.reactive.function.client.ClientResponse;
import org.springframework.web.reactive.function.client.WebClient;

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
        when(budget.usedToday(anyString())).thenReturn(0L);
        when(budget.reserve(anyString(), anyInt(), anyInt())).thenAnswer(invocation ->
            new TrafficRequestBudget.Reservation(
                true,
                ((Integer) invocation.getArgument(1)).longValue(),
                invocation.getArgument(2)
            )
        );

        TileTrafficPoller poller = new TileTrafficPoller(
            failingClient,
            new TrafficProps("key", 120, "tile", 10, "", 1, 500.0, 35_000, 38_000, 40_000, true),
            writer,
            mock(CorridorGeometryStore.class),
            mock(TrafficProviderGuardService.class),
            budget,
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

        assertThatThrownBy(() -> poller.pollAndPersist(List.of(corridor), "key"))
            .hasMessageContaining("403");
        verify(budget).release(eq("tomtom_tile"), intThat(released -> released > 0));
        assertThat(issuedRequests.get()).isLessThanOrEqualTo(2);
        verifyNoInteractions(writer);
    }
}
