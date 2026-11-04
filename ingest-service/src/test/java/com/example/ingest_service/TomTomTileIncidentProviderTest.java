package com.example.ingest_service;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.wdtinc.mapbox_vector_tile.VectorTile;
import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import java.time.LocalDate;
import java.util.List;
import java.util.Optional;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Test;
import org.springframework.core.io.buffer.DefaultDataBufferFactory;
import org.springframework.http.HttpStatus;
import org.springframework.web.reactive.function.client.ClientResponse;
import org.springframework.web.reactive.function.client.WebClient;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;

class TomTomTileIncidentProviderTest {
    private final TrafficProps props = new TrafficProps("fixture", 60, "tile", 10, "", 1, 500, 0, 0, 0, false);
    private final TrafficPullProps pull = new TrafficPullProps(null,
        new TrafficPullProps.Incidents(true, "tomtom", 900, 10, 60), null);
    private final TomTomAccountQuotaManager manager = mock(TomTomAccountQuotaManager.class);
    private final AtomicInteger calls = new AtomicInteger();
    private final TrafficProps.Corridor corridor = new TrafficProps.Corridor("I70", "I70", "I-70", "E", "W", 260.0, 261.0,
        List.of(), "0,0,0,0.01", "{\"type\":\"LineString\",\"coordinates\":[[0,0],[0.01,0]]}", null, 550.0);

    @Test
    void independentIncidentPassReservesTheBatchAndDeduplicatesMappedEvents() throws Exception {
        var account = new TomTomAccount("primary", "fixture");
        when(manager.firstAccount()).thenReturn(Optional.of(account));
        when(manager.availableAccountCount()).thenReturn(1);
        when(manager.reserveCompleteBatch(anyString(), anyLong(), anyInt())).thenAnswer(call -> {
            int count = ((Long) call.getArgument(1)).intValue();
            var start = LocalDate.of(2026, 11, 1);
            return Optional.of(new TomTomAccountQuotaManager.AccountReservation(account,
                new TrafficRequestBudget.MonthlyReservation(true, count, count, 195000, start, start.plusMonths(1),
                    "tomtom", "primary", TomTomRequestGovernor.VECTOR_TILE_PRODUCT)));
        });
        var provider = provider();

        var result = provider.poll(List.of(corridor));

        assertThat(provider.providerName()).isEqualTo("tomtom");
        assertThat(calls).hasValue(1);
        verify(manager).reserveCompleteBatch(TomTomRequestGovernor.VECTOR_TILE_PRODUCT, 1L, 195000);
        var snapshot = result.get("I70");
        assertThat(snapshot.incidentCount()).isEqualTo(1);
        assertThat(snapshot.provider()).isEqualTo("tomtom");
        var mapped = new ObjectMapper().readTree(snapshot.incidentsJson()).path("incidents");
        assertThat(mapped.size()).isEqualTo(1);
        assertThat(mapped.get(0).path("properties").path("providerEventId").asText()).isEqualTo("event-1");
        assertThat(mapped.get(0).path("properties").path("description").asText()).isEqualTo("ROAD WORK");
        assertThat(mapped.get(0).path("geometry").path("type").asText()).isEqualTo("Point");
    }

    @Test
    void absentAccountsAndBlockedBatchesIssueNoIncidentHttpRequests() {
        var provider = provider();
        assertThat(provider.poll(null)).isEmpty();
        assertThat(provider.poll(List.of())).isEmpty();
        assertThat(provider.poll(List.of(corridor))).isEmpty();
        when(manager.firstAccount()).thenReturn(Optional.of(new TomTomAccount("primary", "fixture")));
        when(manager.availableAccountCount()).thenReturn(1);
        assertThat(provider.poll(List.of(corridor))).isEmpty();
        assertThat(calls).hasValue(0);
    }

    private TomTomTileIncidentProvider provider() {
        var client = WebClient.builder().exchangeFunction(request -> {
            calls.incrementAndGet();
            assertThat(request.url().getPath()).contains("/tile/incidents/");
            var body = DefaultDataBufferFactory.sharedInstance.wrap(tile());
            return Mono.just(ClientResponse.create(HttpStatus.OK).body(Flux.just(body)).build());
        }).build();
        var access = new TomTomTileAccess(client, props, pull, mock(CorridorGeometryStore.class),
            mock(TrafficProviderGuardService.class), manager, mock(TomTomRequestGovernor.class), new SimpleMeterRegistry());
        return new TomTomTileIncidentProvider(props, pull, access);
    }

    private static byte[] tile() {
        var feature = VectorTile.Tile.Feature.newBuilder().setType(VectorTile.Tile.GeomType.POINT)
            .addAllTags(List.of(0, 0, 1, 1)).addAllGeometry(List.of(9, 0, 0));
        var layer = VectorTile.Tile.Layer.newBuilder().setVersion(2).setName("Traffic incidents").setExtent(4096)
            .addKeys("id").addKeys("description").addValues(VectorTile.Tile.Value.newBuilder().setStringValue("event-1"))
            .addValues(VectorTile.Tile.Value.newBuilder().setStringValue("ROAD_WORK"))
            .addFeatures(feature).addFeatures(feature);
        return VectorTile.Tile.newBuilder().addLayers(layer).build().toByteArray();
    }
}
