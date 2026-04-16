package com.example.ingest_service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;

import java.util.List;
import java.util.Optional;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.http.HttpStatus;
import org.springframework.web.reactive.function.client.ClientResponse;
import org.springframework.web.reactive.function.client.ExchangeFunction;
import org.springframework.web.reactive.function.client.WebClient;
import reactor.core.publisher.Mono;

@ExtendWith(MockitoExtension.class)
class TrafficProviderGuardServiceTest {

    @Mock
    private TrafficProviderGuardStatusRepository statusRepository;

    @Test
    void startupCheckHaltsPollingWhenTomTomRejectsTheKey() {
        AtomicReference<TrafficProviderGuardStatus> stored = stubRepository();
        WebClient failingClient = WebClient.builder()
            .exchangeFunction(forbiddenExchange())
            .build();

        TrafficProviderGuardService service = new TrafficProviderGuardService(
            statusRepository,
            new TrafficObservabilityProps(15, 80, 95, 3),
            failingClient
        );

        service.verifyProviderAccessAtStartup("test-key");

        assertThat(service.isPollingHalted()).isTrue();
        assertThat(stored.get()).isNotNull();
        assertThat(stored.get().isHalted()).isTrue();
        assertThat(stored.get().getFailureCode()).isEqualTo("AUTH_FORBIDDEN");
    }

    @Test
    void nullDataThresholdHaltsPollingAfterConfiguredNumberOfCycles() {
        AtomicReference<TrafficProviderGuardStatus> stored = stubRepository();
        WebClient healthyClient = WebClient.builder()
            .exchangeFunction(successExchange())
            .build();

        TrafficProviderGuardService service = new TrafficProviderGuardService(
            statusRepository,
            new TrafficObservabilityProps(15, 80, 95, 3),
            healthyClient
        );

        service.recordCycleOutcome("tile", List.of(List.of(), List.of()), 2);
        service.recordCycleOutcome("tile", List.of(List.of(), List.of()), 2);

        assertThat(service.isPollingHalted()).isFalse();
        assertThat(stored.get().getState()).isEqualTo("DEGRADED");

        service.recordCycleOutcome("tile", List.of(List.of(), List.of()), 2);

        assertThat(service.isPollingHalted()).isTrue();
        assertThat(stored.get().isHalted()).isTrue();
        assertThat(stored.get().getFailureCode()).isEqualTo("NULL_DATA_THRESHOLD_EXCEEDED");
    }

    @Test
    void usableCycleClearsNullDataCounter() {
        AtomicReference<TrafficProviderGuardStatus> stored = stubRepository();
        WebClient healthyClient = WebClient.builder()
            .exchangeFunction(successExchange())
            .build();

        TrafficProviderGuardService service = new TrafficProviderGuardService(
            statusRepository,
            new TrafficObservabilityProps(15, 80, 95, 3),
            healthyClient
        );

        service.recordCycleOutcome("tile", List.of(List.of(), List.of()), 2);
        service.recordCycleOutcome("tile", List.of(List.of(45.0), List.of()), 2);

        assertThat(service.isPollingHalted()).isFalse();
        assertThat(stored.get().getState()).isEqualTo("HEALTHY");
        assertThat(stored.get().getConsecutiveNullCycles()).isZero();
    }

    private AtomicReference<TrafficProviderGuardStatus> stubRepository() {
        AtomicReference<TrafficProviderGuardStatus> stored = new AtomicReference<>();
        when(statusRepository.findById("tomtom")).thenAnswer(invocation -> Optional.ofNullable(stored.get()));
        when(statusRepository.save(any(TrafficProviderGuardStatus.class))).thenAnswer(invocation -> {
            TrafficProviderGuardStatus status = invocation.getArgument(0);
            stored.set(status);
            return status;
        });
        return stored;
    }

    private static ExchangeFunction forbiddenExchange() {
        return request -> Mono.just(ClientResponse.create(HttpStatus.FORBIDDEN)
            .header("Content-Type", "application/json")
            .body("{\"detailedError\":{\"code\":\"Forbidden\",\"message\":\"You are not allowed to access this endpoint\"}}")
            .build());
    }

    private static ExchangeFunction successExchange() {
        return request -> Mono.just(ClientResponse.create(HttpStatus.OK)
            .header("Content-Type", "image/png")
            .body("ok")
            .build());
    }
}
