package com.example.ingest_service;

import com.fasterxml.jackson.databind.JsonNode;
import java.time.Duration;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.stereotype.Component;
import org.springframework.web.reactive.function.client.WebClient;
import reactor.core.publisher.Mono;
import reactor.util.retry.Retry;

@Component
public class CdotIncidentClient {

    private static final Logger log = LoggerFactory.getLogger(CdotIncidentClient.class);

    private final WebClient http;

    public CdotIncidentClient(@Qualifier("cdotWebClient") WebClient http) {
        this.http = http;
    }

    public Mono<Feeds> fetch(String apiKey) {
        if (apiKey == null || apiKey.isBlank()) {
            return Mono.error(new IllegalStateException("CDOT_API_KEY is missing or blank"));
        }
        return Mono.zip(
            fetchFeed("/api/v1/incidents", apiKey),
            fetchFeed("/api/v1/plannedEvents", apiKey)
        ).map(result -> new Feeds(result.getT1(), result.getT2()));
    }

    private Mono<JsonNode> fetchFeed(String path, String apiKey) {
        return http.get()
            .uri(builder -> builder
                .path(path)
                .queryParam("apiKey", apiKey)
                .build())
            .retrieve()
            .bodyToMono(JsonNode.class)
            .timeout(Duration.ofSeconds(15))
            .retryWhen(
                Retry.backoff(1, Duration.ofMillis(250))
                    .filter(TransientProviderFailure::isRetryable)
                    .doBeforeRetry(signal -> log.warn(
                        "Retrying CDOT feed {} after a transient failure: {}",
                        path,
                        signal.failure().toString()
                    ))
            );
    }

    public record Feeds(JsonNode incidents, JsonNode plannedEvents) {}
}
