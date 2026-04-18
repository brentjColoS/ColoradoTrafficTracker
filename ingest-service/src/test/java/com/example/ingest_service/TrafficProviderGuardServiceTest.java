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
            new TrafficObservabilityProps(15, 80, 95, 3, 4),
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
            new TrafficObservabilityProps(15, 80, 95, 3, 4),
            healthyClient
        );

        service.recordCycleOutcome("tile", List.of(snapshot("I25", List.of(), "a"), snapshot("US36", List.of(), "b")), 2);
        service.recordCycleOutcome("tile", List.of(snapshot("I25", List.of(), "a"), snapshot("US36", List.of(), "b")), 2);

        assertThat(service.isPollingHalted()).isFalse();
        assertThat(stored.get().getState()).isEqualTo("DEGRADED");

        service.recordCycleOutcome("tile", List.of(snapshot("I25", List.of(), "a"), snapshot("US36", List.of(), "b")), 2);

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
            new TrafficObservabilityProps(15, 80, 95, 3, 4),
            healthyClient
        );

        service.recordCycleOutcome("tile", List.of(snapshot("I25", List.of(), "a"), snapshot("US36", List.of(), "b")), 2);
        service.recordCycleOutcome("tile", List.of(snapshot("I25", List.of(45.0), "c"), snapshot("US36", List.of(), "d")), 2);

        assertThat(service.isPollingHalted()).isFalse();
        assertThat(stored.get().getState()).isEqualTo("HEALTHY");
        assertThat(stored.get().getConsecutiveNullCycles()).isZero();
    }

    @Test
    void repeatedUsablePayloadTriggersStaleWarningWithoutHaltingPolling() {
        AtomicReference<TrafficProviderGuardStatus> stored = stubRepository();
        WebClient healthyClient = WebClient.builder()
            .exchangeFunction(successExchange())
            .build();

        TrafficProviderGuardService service = new TrafficProviderGuardService(
            statusRepository,
            new TrafficObservabilityProps(15, 80, 95, 3, 2),
            healthyClient
        );

        List<ProviderCycleSnapshot> repeatedCycle = List.of(
            snapshot("I25", List.of(61.0, 62.0), "same-i25"),
            snapshot("US36", List.of(54.0, 55.0), "same-us36")
        );

        service.recordCycleOutcome("tile", repeatedCycle, 2);
        service.recordCycleOutcome("tile", repeatedCycle, 2);

        assertThat(service.isPollingHalted()).isFalse();
        assertThat(stored.get().isHalted()).isFalse();
        assertThat(stored.get().getState()).isEqualTo("HEALTHY");

        service.recordCycleOutcome("tile", repeatedCycle, 2);

        assertThat(service.isPollingHalted()).isFalse();
        assertThat(stored.get().isHalted()).isFalse();
        assertThat(stored.get().getState()).isEqualTo("DEGRADED");
        assertThat(stored.get().getFailureCode()).isEqualTo("STALE_PAYLOAD_WARNING");
        assertThat(stored.get().getConsecutiveStaleCycles()).isEqualTo(2);
    }

    @Test
    void changedUsablePayloadClearsStaleCounter() {
        AtomicReference<TrafficProviderGuardStatus> stored = stubRepository();
        WebClient healthyClient = WebClient.builder()
            .exchangeFunction(successExchange())
            .build();

        TrafficProviderGuardService service = new TrafficProviderGuardService(
            statusRepository,
            new TrafficObservabilityProps(15, 80, 95, 3, 2),
            healthyClient
        );

        service.recordCycleOutcome("tile", List.of(snapshot("I25", List.of(61.0), "same")), 1);
        service.recordCycleOutcome("tile", List.of(snapshot("I25", List.of(61.0), "same")), 1);
        service.recordCycleOutcome("tile", List.of(snapshot("I25", List.of(62.0), "changed")), 1);

        assertThat(stored.get().getState()).isEqualTo("HEALTHY");
        assertThat(stored.get().getConsecutiveStaleCycles()).isZero();
        assertThat(stored.get().getFailureCode()).isNull();
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

    private static ProviderCycleSnapshot snapshot(String corridor, List<Double> speeds, String signature) {
        return new ProviderCycleSnapshot(corridor, speeds, signature);
    }
}
