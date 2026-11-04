package com.example.ingest_service;

import java.time.Duration;
import org.springframework.web.reactive.function.client.WebClient;
import reactor.core.publisher.Mono;

final class TomTomProviderProbe {
    private final WebClient http;
    private final TomTomRequestGovernor requestGovernor;

    TomTomProviderProbe(WebClient http, TomTomRequestGovernor requestGovernor) {
        this.http = http;
        this.requestGovernor = requestGovernor;
    }

    void verifyMapAccess(TomTomAccount account) {
        requestGovernor.mapDisplayRaster(account, this::raster).block();
    }

    void verifyMapAccess() {
        requestGovernor.mapDisplayRaster(this::raster).block();
    }

    void verifyTrafficCredits() {
        requestGovernor.vectorTile(account ->
            http.get()
                .uri(u -> u.path("/traffic/map/4/tile/flow/absolute/11/426/776.pbf")
                    .queryParam("roadTypes", "[0,1,2]")
                    .queryParam("margin", "0")
                    .queryParam("key", account.apiKey())
                    .build())
                .retrieve()
                .bodyToMono(byte[].class)
                .timeout(Duration.ofSeconds(8))
            )
            .block();
    }

    private Mono<byte[]> raster(TomTomAccount account) {
        return http.get()
            .uri(u -> u.path("/map/1/tile/basic/main/0/0/0.png")
                .queryParam("view", "Unified")
                .queryParam("key", account.apiKey())
                .build())
            .retrieve()
            .bodyToMono(byte[].class)
            .timeout(Duration.ofSeconds(8));
    }
}
