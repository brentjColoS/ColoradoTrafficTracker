package com.example.api_service;

import com.fasterxml.jackson.databind.JsonNode;
import java.net.http.HttpClient;
import java.time.Duration;
import java.util.Optional;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.MediaType;
import org.springframework.http.client.JdkClientHttpRequestFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;

@Component
class DirectionalCorridorGeometryClient {
    private static final Logger log = LoggerFactory.getLogger(DirectionalCorridorGeometryClient.class);

    private final RestClient routes;

    DirectionalCorridorGeometryClient(RoutesServiceProps props) {
        this(buildClient(props.baseUrl()));
    }

    DirectionalCorridorGeometryClient(RestClient routes) {
        this.routes = routes;
    }

    Optional<JsonNode> fetch(String corridor) {
        try {
            return Optional.ofNullable(routes.get()
                .uri("/routes/corridors/{corridor}/directions", corridor)
                .accept(MediaType.parseMediaType("application/geo+json"))
                .retrieve()
                .body(JsonNode.class));
        } catch (RestClientException error) {
            log.warn(
                "Directional corridor geometry is unavailable for {}; the map will retain combined traffic: {}",
                corridor,
                error.toString()
            );
            return Optional.empty();
        }
    }

    private static RestClient buildClient(String baseUrl) {
        HttpClient httpClient = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(3))
            .build();
        JdkClientHttpRequestFactory requestFactory = new JdkClientHttpRequestFactory(httpClient);
        requestFactory.setReadTimeout(Duration.ofSeconds(5));
        return RestClient.builder()
            .baseUrl(baseUrl)
            .requestFactory(requestFactory)
            .build();
    }
}
