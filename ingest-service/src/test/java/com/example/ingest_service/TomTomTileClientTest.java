package com.example.ingest_service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import com.wdtinc.mapbox_vector_tile.VectorTile;
import java.io.IOException;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.concurrent.atomic.AtomicLong;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.core.io.buffer.DefaultDataBufferFactory;
import org.springframework.http.HttpStatus;
import org.springframework.web.reactive.function.client.ClientRequest;
import org.springframework.web.reactive.function.client.ClientResponse;
import org.springframework.web.reactive.function.client.WebClient;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;

class TomTomTileClientTest {
    private static final TrafficTile TILE = new TrafficTile(10, 213, 388);
    private static final TomTomAccount ACCOUNT = new TomTomAccount("primary", "test-only");
    private final TomTomAccountQuotaManager manager = mock(TomTomAccountQuotaManager.class);
    private final TrafficProviderGuardService guard = mock(TrafficProviderGuardService.class);
    private final TileQuotaUsage usage = mock(TileQuotaUsage.class);
    private final List<ClientRequest> requests = new ArrayList<>();
    private final AtomicLong issuedInitialCalls = new AtomicLong();

    @BeforeEach
    void configureQuota() {
        when(usage.config()).thenReturn(config());
    }

    @Test
    void flowAndIncidentRequestsKeepTheirParametersHeadersAndLayerFilters() {
        var client = client(HttpStatus.OK, false);
        var flow = client.fetchFlowTiles(Set.of(TILE), ACCOUNT, 1, issuedInitialCalls, Set.of(TILE)).block();
        var incidents = client.fetchIncidentTiles(Set.of(TILE), ACCOUNT, 1, issuedInitialCalls).block();

        assertThat(flow.get(TILE)).singleElement().satisfies(value -> assertThat(value.layerName()).isEqualTo("Traffic flow"));
        assertThat(incidents.get(TILE)).singleElement().satisfies(value -> assertThat(value.layerName()).isEqualTo("Traffic incidents"));
        assertThat(requests.get(0).url().getPath()).endsWith("/flow/absolute/10/213/388.pbf");
        assertThat(requests.get(0).url().getQuery()).contains("trafficLevelStep=1", "roadTypes=", "margin=0");
        assertThat(requests.get(1).url().getPath()).endsWith("/incidents/10/213/388.pbf");
        assertThat(requests.get(1).url().getQuery()).contains("tags=").doesNotContain("trafficLevelStep");
        assertThat(requests).allSatisfy(request -> {
            assertThat(request.headers().getFirst("Cache-Control")).isEqualTo("no-cache");
            assertThat(request.headers().getFirst("Pragma")).isEqualTo("no-cache");
            assertThat(request.headers().getFirst("Tracking-ID")).isNotBlank();
        });
        assertThat(issuedInitialCalls).hasValue(2);
        verifyNoInteractions(manager);
    }

    @Test
    void retriesChargeTheSameAccountWithoutConsumingAnotherInitialReservation() {
        when(usage.config()).thenReturn(config());
        when(manager.reserveForAccount(ACCOUNT, TomTomRequestGovernor.VECTOR_TILE_PRODUCT, 1, 195000))
            .thenReturn(Optional.of(mock(TomTomAccountQuotaManager.AccountReservation.class)));
        var client = client(HttpStatus.OK, true);

        assertThat(client.fetchFlowTiles(Set.of(TILE), ACCOUNT, 1, issuedInitialCalls, Set.of()).block()).containsKey(TILE);

        assertThat(requests).hasSize(2).allSatisfy(request ->
            assertThat(request.url().getQuery()).contains("key=test-only"));
        assertThat(issuedInitialCalls).hasValue(1);
        verify(manager).reserveForAccount(ACCOUNT, TomTomRequestGovernor.VECTOR_TILE_PRODUCT, 1, 195000);
        verify(usage).refresh(390000);
    }

    @Test
    void aBlockedRetryDoesNotIssueAnotherRequest() {
        when(usage.config()).thenReturn(config());
        when(manager.reserveForAccount(any(), anyString(), anyInt(), anyInt())).thenReturn(Optional.empty());

        assertThatThrownBy(() -> client(HttpStatus.OK, true)
            .fetchFlowTiles(Set.of(TILE), ACCOUNT, 1, issuedInitialCalls, Set.of()).block())
            .isInstanceOf(TomTomRequestQuotaExceededException.class);

        assertThat(requests).hasSize(1);
        assertThat(issuedInitialCalls).hasValue(1);
    }

    @Test
    void anAuthorizationFailureQuarantinesOnlyTheAccountWhileAnotherRemainsAvailable() {
        when(guard.isAuthorizationFailure(any())).thenReturn(true);
        when(manager.hasAvailableAccount()).thenReturn(true);

        assertThatThrownBy(() -> client(HttpStatus.FORBIDDEN, false)
            .fetchFlowTiles(Set.of(TILE), ACCOUNT, 1, issuedInitialCalls, Set.of()).block()).hasMessageContaining("403");

        assertThat(requests).hasSize(1);
        verify(manager).markAuthorizationFailed("primary");
        verify(guard, never()).tripAuthorizationFailure(anyString(), anyInt(), anyString());
        verify(manager, never()).reserveForAccount(any(), anyString(), anyInt(), anyInt());
    }

    private TomTomTileClient client(HttpStatus status, boolean firstRequestFails) {
        var http = WebClient.builder().exchangeFunction(request -> {
            requests.add(request);
            if (firstRequestFails && requests.size() == 1) return Mono.error(new IOException("fixture reset"));
            return Mono.just(ClientResponse.create(status).body(Flux.just(
                DefaultDataBufferFactory.sharedInstance.wrap(tile()))).build());
        }).build();
        return new TomTomTileClient(http, guard, manager, usage);
    }

    private static TileQuotaUsage.Config config() {
        return new TileQuotaUsage.Config(380000, 380000, 390000, 400000, 190000, 195000, 200000, 2);
    }

    private static byte[] tile() {
        var feature = VectorTile.Tile.Feature.newBuilder().setType(VectorTile.Tile.GeomType.POINT)
            .addAllGeometry(List.of(9, 0, 0));
        var tile = VectorTile.Tile.newBuilder();
        for (String name : List.of("Traffic flow", "Traffic incidents")) {
            tile.addLayers(VectorTile.Tile.Layer.newBuilder().setVersion(2).setName(name).addFeatures(feature));
        }
        return tile.build().toByteArray();
    }
}
