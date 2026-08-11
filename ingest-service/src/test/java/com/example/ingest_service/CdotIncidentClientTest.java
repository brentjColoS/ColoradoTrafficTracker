package com.example.ingest_service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.io.IOException;
import java.net.URI;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.web.reactive.function.client.ClientResponse;
import org.springframework.web.reactive.function.client.WebClient;
import reactor.core.publisher.Mono;

class CdotIncidentClientTest {

    @Test
    void fetchesBothDocumentedFeedsWithTheSubscriberKey() {
        Set<URI> requests = ConcurrentHashMap.newKeySet();
        WebClient http = WebClient.builder()
            .baseUrl("https://data.cotrip.org")
            .exchangeFunction(request -> {
                requests.add(request.url());
                return Mono.just(
                    ClientResponse.create(HttpStatus.OK)
                        .header(HttpHeaders.CONTENT_TYPE, "application/json")
                        .body("{\"type\":\"FeatureCollection\",\"features\":[]}")
                        .build()
                );
            })
            .build();

        CdotIncidentClient.Feeds feeds = new CdotIncidentClient(http)
            .fetch("fixture-key")
            .block();

        assertThat(feeds).isNotNull();
        assertThat(requests)
            .extracting(URI::getPath)
            .containsExactlyInAnyOrder("/api/v1/incidents", "/api/v1/plannedEvents");
        assertThat(requests)
            .allMatch(uri -> "apiKey=fixture-key".equals(uri.getQuery()));
    }

    @Test
    void refusesToIssueRequestsWithoutAKey() {
        CdotIncidentClient client = new CdotIncidentClient(WebClient.builder().build());

        assertThatThrownBy(() -> client.fetch(" ").block())
            .isInstanceOf(IllegalStateException.class)
            .hasMessageContaining("CDOT_API_KEY");
    }

    @Test
    void retriesOnlyTheFeedThatHadATransientFailure() {
        AtomicInteger incidentRequests = new AtomicInteger();
        AtomicInteger plannedEventRequests = new AtomicInteger();
        WebClient http = WebClient.builder()
            .baseUrl("https://data.cotrip.org")
            .exchangeFunction(request -> {
                if (request.url().getPath().equals("/api/v1/incidents")) {
                    if (incidentRequests.incrementAndGet() == 1) {
                        return Mono.error(new IOException("connection reset"));
                    }
                } else {
                    plannedEventRequests.incrementAndGet();
                }
                return Mono.just(okResponse());
            })
            .build();

        CdotIncidentClient.Feeds feeds = new CdotIncidentClient(http)
            .fetch("fixture-key")
            .block();

        assertThat(feeds).isNotNull();
        assertThat(incidentRequests).hasValue(2);
        assertThat(plannedEventRequests).hasValue(1);
    }

    @Test
    void doesNotRetryAClientError() {
        AtomicInteger incidentRequests = new AtomicInteger();
        WebClient http = WebClient.builder()
            .baseUrl("https://data.cotrip.org")
            .exchangeFunction(request -> {
                if (request.url().getPath().equals("/api/v1/incidents")) {
                    incidentRequests.incrementAndGet();
                    return Mono.just(ClientResponse.create(HttpStatus.UNAUTHORIZED).build());
                }
                return Mono.just(okResponse());
            })
            .build();

        assertThatThrownBy(() -> new CdotIncidentClient(http).fetch("fixture-key").block())
            .hasMessageContaining("401");
        assertThat(incidentRequests).hasValue(1);
    }

    private static ClientResponse okResponse() {
        return ClientResponse.create(HttpStatus.OK)
            .header(HttpHeaders.CONTENT_TYPE, "application/json")
            .body("{\"type\":\"FeatureCollection\",\"features\":[]}")
            .build();
    }
}
