package com.example.ingest_service;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.stereotype.Component;
import org.springframework.web.reactive.function.client.WebClient;
import reactor.core.publisher.Mono;
import reactor.util.retry.Retry;

import java.time.Duration;
import java.util.List;

@Component
public class RoutesClient {

    private static final Logger log = LoggerFactory.getLogger(RoutesClient.class);

    private final WebClient routesHttp;

    public RoutesClient(@Qualifier("routesWebClient") WebClient routesHttp) {
        this.routesHttp = routesHttp;
    }

    public Mono<List<TrafficProps.Corridor>> fetchCorridors() {
        return routesHttp.get()
            .uri("/routes/corridors")
            .retrieve()
            .bodyToFlux(TrafficProps.Corridor.class)
            .collectList()
            .timeout(Duration.ofSeconds(5))
            .retryWhen(Retry.backoff(2, Duration.ofMillis(250)))
            .onErrorResume(e -> {
                log.warn("Failed to fetch corridors from routes-service: {}", e.toString());
                return Mono.just(List.of());
            });
    }
}
