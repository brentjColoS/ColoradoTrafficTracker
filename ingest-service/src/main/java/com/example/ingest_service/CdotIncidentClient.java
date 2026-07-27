package com.example.ingest_service;

import com.fasterxml.jackson.databind.JsonNode;
import java.time.Duration;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.stereotype.Component;
import org.springframework.web.reactive.function.client.WebClient;
import reactor.core.publisher.Mono;

@Component
public class CdotIncidentClient {

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
            .timeout(Duration.ofSeconds(15));
    }

    public record Feeds(JsonNode incidents, JsonNode plannedEvents) {}
}
