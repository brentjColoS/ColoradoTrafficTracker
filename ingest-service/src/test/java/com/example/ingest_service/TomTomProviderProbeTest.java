package com.example.ingest_service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import java.net.URI;
import java.util.ArrayList;
import java.util.List;
import java.util.function.Function;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.web.reactive.function.client.ClientResponse;
import org.springframework.web.reactive.function.client.WebClient;
import reactor.core.publisher.Mono;

class TomTomProviderProbeTest {
    @Test
    void eachProbeUsesTheExistingBudgetProductAndAccountSelection() {
        var account = new TomTomAccount("primary", "fixture");
        var governor = mock(TomTomRequestGovernor.class);
        when(governor.mapDisplayRaster(eq(account), any())).thenAnswer(call -> invoke(call.getArgument(1), account));
        when(governor.mapDisplayRaster(any())).thenAnswer(call -> invoke(call.getArgument(0), account));
        when(governor.vectorTile(any())).thenAnswer(call -> invoke(call.getArgument(0), account));
        List<URI> requests = new ArrayList<>();
        var client = WebClient.builder().exchangeFunction(request -> {
            requests.add(request.url());
            return Mono.just(ClientResponse.create(HttpStatus.OK).body("fixture").build());
        }).build();
        var probe = new TomTomProviderProbe(client, governor);

        probe.verifyMapAccess(account);
        probe.verifyMapAccess();
        probe.verifyTrafficCredits();

        verify(governor).mapDisplayRaster(eq(account), any());
        verify(governor).mapDisplayRaster(any());
        verify(governor).vectorTile(any());
        verifyNoMoreInteractions(governor);
        assertThat(requests).extracting(URI::getPath).containsExactly(
            "/map/1/tile/basic/main/0/0/0.png", "/map/1/tile/basic/main/0/0/0.png",
            "/traffic/map/4/tile/flow/absolute/11/426/776.pbf");
        assertThat(requests.get(0).getQuery()).contains("view=Unified");
        assertThat(requests.get(2).getQuery()).contains("margin=0", "roadTypes=");
    }

    private static Mono<byte[]> invoke(Function<TomTomAccount, Mono<byte[]>> request, TomTomAccount account) {
        return request.apply(account);
    }
}
