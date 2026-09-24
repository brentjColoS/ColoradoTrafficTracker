package com.example.ingest_service;

import com.fasterxml.jackson.databind.JsonNode;
import java.io.IOException;
import java.time.Duration;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.TimeoutException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.stereotype.Component;
import org.springframework.web.reactive.function.client.WebClient;
import org.springframework.web.reactive.function.client.WebClientResponseException;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;
import reactor.util.retry.Retry;

@Component
public class RoutesClient {

    private static final Logger log = LoggerFactory.getLogger(RoutesClient.class);
    private static final List<String> DIRECTIONS = List.of(
        "NORTHBOUND",
        "SOUTHBOUND",
        "EASTBOUND",
        "WESTBOUND"
    );

    private final WebClient routesHttp;
    private final Map<String, Map<String, List<double[]>>> directionalRouteCache = new ConcurrentHashMap<>();

    public RoutesClient(@Qualifier("routesWebClient") WebClient routesHttp) {
        this.routesHttp = routesHttp;
    }

    public Mono<List<TrafficProps.Corridor>> fetchCorridors() {
        return routesHttp.get()
            .uri("/routes/corridors")
            .retrieve()
            .bodyToFlux(TrafficProps.Corridor.class)
            .collectList()
            .flatMap(corridors -> Flux.fromIterable(corridors)
                .concatMap(this::withDirectionalRoutes)
                .collectList())
            .timeout(Duration.ofSeconds(5))
            .retryWhen(
                Retry.backoff(2, Duration.ofMillis(250))
                    .filter(ex -> {
                        if (ex instanceof WebClientResponseException w) {
                            return w.getStatusCode().is5xxServerError();
                        }
                        return (ex instanceof TimeoutException) || (ex instanceof IOException);
                    })
            )
            .onErrorResume(e -> {
                log.warn("Failed to fetch corridors from routes-service: {}", e.toString());
                return Mono.just(List.of());
            });
    }

    private Mono<TrafficProps.Corridor> withDirectionalRoutes(TrafficProps.Corridor corridor) {
        String corridorCode = normalizedCorridor(corridor.name());
        Map<String, List<double[]>> cached = directionalRouteCache.get(corridorCode);
        if (cached != null) return Mono.just(corridor.withDirectionalRoutes(cached));

        return routesHttp.get()
            .uri("/routes/corridors/{corridor}/directions", corridorCode)
            .retrieve()
            .bodyToMono(JsonNode.class)
            .map(RoutesClient::parseDirectionalRoutes)
            .doOnNext(routes -> {
                if (!routes.isEmpty()) directionalRouteCache.put(corridorCode, routes);
            })
            .map(corridor::withDirectionalRoutes)
            .timeout(Duration.ofSeconds(5))
            .retryWhen(
                Retry.backoff(2, Duration.ofMillis(250))
                    .filter(RoutesClient::isTransientFailure)
            )
            .onErrorResume(error -> {
                log.warn(
                    "Directional geometry is unavailable for {}; flow cells will remain combined: {}",
                    corridorCode,
                    error.toString()
                );
                return Mono.just(corridor.withDirectionalRoutes(Map.of()));
            });
    }

    static Map<String, List<double[]>> parseDirectionalRoutes(JsonNode root) {
        JsonNode features = root == null ? null : root.path("features");
        if (features == null || !features.isArray()) return Map.of();

        Map<String, List<double[]>> routes = new LinkedHashMap<>();
        for (JsonNode feature : features) {
            String direction = feature.path("properties").path("direction").asText("")
                .trim()
                .toUpperCase(Locale.ROOT);
            if (!DIRECTIONS.contains(direction)) continue;
            JsonNode geometry = feature.path("geometry");
            if (!"LineString".equals(geometry.path("type").asText())) continue;

            List<double[]> route = coordinates(geometry.path("coordinates"));
            if (route.size() >= 2) routes.put(direction, route);
        }
        return Map.copyOf(routes);
    }

    private static List<double[]> coordinates(JsonNode coordinates) {
        if (coordinates == null || !coordinates.isArray()) return List.of();
        java.util.ArrayList<double[]> route = new java.util.ArrayList<>();
        for (JsonNode coordinate : coordinates) {
            if (!coordinate.isArray() || coordinate.size() < 2) continue;
            double longitude = coordinate.get(0).asDouble(Double.NaN);
            double latitude = coordinate.get(1).asDouble(Double.NaN);
            if (Double.isFinite(latitude) && Double.isFinite(longitude)) {
                route.add(new double[]{latitude, longitude});
            }
        }
        return List.copyOf(route);
    }

    private static boolean isTransientFailure(Throwable error) {
        if (error instanceof WebClientResponseException response) {
            return response.getStatusCode().is5xxServerError();
        }
        return error instanceof TimeoutException || error instanceof IOException;
    }

    private static String normalizedCorridor(String corridor) {
        return corridor == null ? "" : corridor.trim().toUpperCase(Locale.ROOT).replace("-", "");
    }
}
