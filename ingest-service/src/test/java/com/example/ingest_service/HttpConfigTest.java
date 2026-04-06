package com.example.ingest_service;

import static org.assertj.core.api.Assertions.assertThat;

import java.net.URI;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.web.reactive.function.client.ClientResponse;
import org.springframework.web.reactive.function.client.ExchangeFunction;
import org.springframework.web.reactive.function.client.WebClient;
import reactor.core.publisher.Mono;

class HttpConfigTest {

    private final HttpConfig config = new HttpConfig();

    @Test
    void tomtomClientUsesTomtomBaseUrl() {
        AtomicReference<URI> captured = new AtomicReference<>();
        WebClient.Builder builder = testBuilder(captured);

        WebClient client = config.tomtomWebClient(builder);
        client.get().uri("/traffic/services/4/ping").retrieve().bodyToMono(String.class).block();

        assertThat(captured.get()).isNotNull();
        assertThat(captured.get().toString()).startsWith("https://api.tomtom.com/traffic/services/4/ping");
    }

    @Test
    void routesClientFallsBackToServiceUrlWhenBaseUrlBlank() {
        AtomicReference<URI> captured = new AtomicReference<>();
        WebClient.Builder builder = testBuilder(captured);

        WebClient client = config.routesWebClient(builder, new RoutesServiceProps(" "));
        client.get().uri("/routes/corridors").retrieve().bodyToMono(String.class).block();

        assertThat(captured.get()).isNotNull();
        assertThat(captured.get().toString()).startsWith("http://routes-service:8081/routes/corridors");
    }

    @Test
    void routesClientUsesConfiguredBaseUrlWhenProvided() {
        AtomicReference<URI> captured = new AtomicReference<>();
        WebClient.Builder builder = testBuilder(captured);

        WebClient client = config.routesWebClient(builder, new RoutesServiceProps("http://localhost:9999"));
        client.get().uri("/routes/corridors").retrieve().bodyToMono(String.class).block();

        assertThat(captured.get()).isNotNull();
        assertThat(captured.get().toString()).startsWith("http://localhost:9999/routes/corridors");
    }

    private static WebClient.Builder testBuilder(AtomicReference<URI> captured) {
        ExchangeFunction exchangeFunction = request -> {
            captured.set(request.url());
            return Mono.just(
                ClientResponse.create(HttpStatus.OK)
                    .header(HttpHeaders.CONTENT_TYPE, "application/json")
                    .body("[]")
                    .build()
            );
        };
        return WebClient.builder().exchangeFunction(exchangeFunction);
    }
}
