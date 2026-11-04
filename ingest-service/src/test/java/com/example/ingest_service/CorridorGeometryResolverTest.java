package com.example.ingest_service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

import com.fasterxml.jackson.databind.JsonNode;
import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import java.net.URI;
import java.util.ArrayList;
import java.util.List;
import java.util.function.Function;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.web.reactive.function.client.ClientResponse;
import org.springframework.web.reactive.function.client.WebClient;
import reactor.core.publisher.Mono;

class CorridorGeometryResolverTest {
    private final CorridorGeometryStore store = mock(CorridorGeometryStore.class);
    private final TrafficProviderGuardService guard = mock(TrafficProviderGuardService.class);
    private final TomTomRequestGovernor governor = mock(TomTomRequestGovernor.class);
    private final List<URI> requests = new ArrayList<>();

    @Test
    void configuredGeometryIsCachedWithoutProviderOrDatabaseCalls() {
        var resolver = resolver(HttpStatus.OK);
        var corridor = corridor("{\"type\":\"LineString\",\"coordinates\":[[-105,40],[-105,40.01]]}");

        var first = resolver.resolve(corridor).block();

        assertThat(first.polyline()).hasSize(2);
        assertThat(first.fromRouting()).isFalse();
        assertThat(resolver.resolve(corridor).block()).isSameAs(first);
        assertThat(requests).isEmpty();
        verifyNoInteractions(store, governor);
    }

    @Test
    void successfulRoutingPersistsAndCachesGeometry() {
        routeRequestsThroughGovernor();
        var resolver = resolver(HttpStatus.OK);
        var first = resolver.resolve(corridor(null)).block();

        assertThat(first.fromRouting()).isTrue();
        assertThat(first.polyline()).hasSize(2);
        assertThat(resolver.resolve(corridor(null)).block()).isSameAs(first);
        assertThat(requests).hasSize(1);
        assertThat(requests.get(0).getQuery()).contains("traffic=true", "avoid=unpavedRoads");
        verify(store).updateFromRouting("I70", first.polyline());
    }

    @Test
    void failedRoutingIsReportedAndRetriedOnTheNextResolution() {
        routeRequestsThroughGovernor();
        var resolver = resolver(HttpStatus.BAD_GATEWAY);

        assertThat(resolver.resolve(corridor(null)).blockOptional()).isEmpty();
        assertThat(resolver.resolve(corridor(null)).blockOptional()).isEmpty();

        assertThat(requests).hasSize(2);
        verifyNoInteractions(store);
        verify(guard, times(2)).recordRecoverableProviderFailure(eq("routing/1/calculateRoute"), any(Throwable.class));
    }

    @Test
    void pointModeKeepsBoundingBoxSamplingWhenRoutingFails() {
        routeRequestsThroughGovernor();
        var client = client(HttpStatus.BAD_GATEWAY);
        var routes = mock(RoutesClient.class);
        when(routes.fetchCorridors()).thenReturn(Mono.just(List.of(corridor(null))));
        var writer = mock(TrafficSampleWriter.class);
        when(governor.flowSegment(any())).thenAnswer(invocation -> invokeRequest(invocation.getArgument(0)));
        when(governor.incidentDetails(any())).thenAnswer(invocation -> invokeRequest(invocation.getArgument(0)));
        var poller = new TrafficPoller(client,
            new TrafficProps("test-only", 60, "point", 10, "", 1, 500, 0, 0, 0, false),
            routes, writer, mock(CorridorMetadataSyncService.class), store, new TrafficPullProps(null, null, null),
            List.of(), mock(TrafficSchedulerLease.class), governor, guard, new SimpleMeterRegistry());

        poller.pollOnce();
        poller.pollOnce();

        assertThat(requests.stream().filter(uri -> uri.getPath().startsWith("/routing/"))).hasSize(2);
        assertThat(requests.stream().filter(uri -> uri.getPath().contains("flowSegmentData"))).hasSize(10);
        var sample = org.mockito.ArgumentCaptor.forClass(TrafficSample.class);
        verify(writer, times(2)).saveSample(sample.capture());
        assertThat(sample.getAllValues()).allSatisfy(value -> {
            assertThat(value.getAvgCurrentSpeed()).isEqualTo(50.0);
            assertThat(value.getSpeedSampleCount()).isEqualTo(5);
            assertThat(value.getSourceMode()).isEqualTo("point");
        });
    }

    private CorridorGeometryResolver resolver(HttpStatus routingStatus) {
        return new CorridorGeometryResolver(client(routingStatus), store, guard, governor);
    }

    private WebClient client(HttpStatus routingStatus) {
        return WebClient.builder().exchangeFunction(request -> {
            requests.add(request.url());
            boolean routing = request.url().getPath().startsWith("/routing/");
            String body = routing
                ? "{\"routes\":[{\"legs\":[{\"points\":[{\"latitude\":40,\"longitude\":-105},{\"latitude\":40.01,\"longitude\":-105}]}]}]}"
                : request.url().getPath().contains("flowSegmentData")
                    ? "{\"flowSegmentData\":{\"frc\":\"FRC0\",\"currentSpeed\":50,\"freeFlowSpeed\":60,\"confidence\":1}}"
                    : "{\"incidents\":[]}";
            return Mono.just(ClientResponse.create(routing ? routingStatus : HttpStatus.OK)
                .header("Content-Type", "application/json").body(body).build());
        }).build();
    }

    private void routeRequestsThroughGovernor() {
        when(governor.routing(any())).thenAnswer(invocation -> invokeRequest(invocation.getArgument(0)));
    }

    private static Mono<JsonNode> invokeRequest(Function<TomTomAccount, Mono<JsonNode>> request) {
        return request.apply(new TomTomAccount("primary", "test-only"));
    }

    private static TrafficProps.Corridor corridor(String geometry) {
        return new TrafficProps.Corridor("I70", "I70", "I-70", "E", "W", 260.0, 261.0,
            List.of(), "40,-105,40.01,-104.99", geometry, null, 550.0);
    }
}
