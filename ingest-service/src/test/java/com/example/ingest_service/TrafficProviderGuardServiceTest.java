package com.example.ingest_service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;

import java.time.OffsetDateTime;
import java.time.ZoneOffset;
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
import org.springframework.web.reactive.function.client.WebClientResponseException;
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
            new TrafficObservabilityProps(15, 80, 95, 3, 4, 60),
            failingClient
        );

        service.verifyProviderAccessAtStartup("test-key");

        assertThat(service.isPollingHalted()).isTrue();
        assertThat(stored.get()).isNotNull();
        assertThat(stored.get().isHalted()).isTrue();
        assertThat(stored.get().getFailureCode()).isEqualTo("AUTH_FORBIDDEN");
    }

    @Test
    void nullDataThresholdEntersRecoveringStateWithoutHaltingPolling() {
        AtomicReference<TrafficProviderGuardStatus> stored = stubRepository();
        WebClient healthyClient = WebClient.builder()
            .exchangeFunction(successExchange())
            .build();

        TrafficProviderGuardService service = new TrafficProviderGuardService(
            statusRepository,
            new TrafficObservabilityProps(15, 80, 95, 3, 4, 60),
            healthyClient
        );

        service.recordCycleOutcome("tile", List.of(snapshot("I25", List.of(), "a"), snapshot("US36", List.of(), "b")), 2);
        service.recordCycleOutcome("tile", List.of(snapshot("I25", List.of(), "a"), snapshot("US36", List.of(), "b")), 2);

        assertThat(service.isPollingHalted()).isFalse();
        assertThat(stored.get().getState()).isEqualTo("DEGRADED");

        service.recordCycleOutcome("tile", List.of(snapshot("I25", List.of(), "a"), snapshot("US36", List.of(), "b")), 2);

        assertThat(service.isPollingHalted()).isFalse();
        assertThat(service.isRecovering()).isTrue();
        assertThat(stored.get().isHalted()).isFalse();
        assertThat(stored.get().getState()).isEqualTo("RECOVERING");
        assertThat(stored.get().getFailureCode()).isEqualTo("EMPTY_PAYLOAD_RECOVERING");
        assertThat(stored.get().getDetailsJson()).contains("\"failureCategory\":\"EMPTY_PAYLOAD\"");
        assertThat(stored.get().getShutdownTriggeredAt()).isNull();
    }

    @Test
    void classifiedRecoverableFailureDrivesRecoveringStatus() {
        AtomicReference<TrafficProviderGuardStatus> stored = stubRepository();
        WebClient healthyClient = WebClient.builder()
            .exchangeFunction(successExchange())
            .build();

        TrafficProviderGuardService service = new TrafficProviderGuardService(
            statusRepository,
            new TrafficObservabilityProps(15, 80, 95, 2, 4, 60),
            healthyClient
        );

        service.recordRecoverableProviderFailure(
            "traffic/map/4/tile/flow",
            WebClientResponseException.create(429, "Too Many Requests", null, new byte[0], null)
        );

        service.recordCycleOutcome("tile", List.of(snapshot("I25", List.of(), "a")), 1);
        service.recordCycleOutcome("tile", List.of(snapshot("I25", List.of(), "a")), 1);

        assertThat(stored.get().getState()).isEqualTo("RECOVERING");
        assertThat(stored.get().getFailureCode()).isEqualTo("RATE_LIMIT_RECOVERING");
        assertThat(stored.get().getMessage()).contains("rate-limited");
        assertThat(stored.get().getDetailsJson()).contains("\"failureCategory\":\"RATE_LIMIT\"");
        assertThat(stored.get().getDetailsJson()).contains("traffic/map/4/tile/flow");
    }

    @Test
    void higherPriorityRecoverableFailureWinsWithinCycle() {
        AtomicReference<TrafficProviderGuardStatus> stored = stubRepository();
        WebClient healthyClient = WebClient.builder()
            .exchangeFunction(successExchange())
            .build();

        TrafficProviderGuardService service = new TrafficProviderGuardService(
            statusRepository,
            new TrafficObservabilityProps(15, 80, 95, 1, 4, 60),
            healthyClient
        );

        service.recordRecoverableProviderFailure(
            ProviderFailureCategory.NETWORK,
            "traffic/map/4/tile/flow",
            "Timed out"
        );
        service.recordRecoverableProviderFailure(
            ProviderFailureCategory.PROVIDER_5XX,
            "traffic/map/4/tile/incidents",
            "Bad gateway"
        );

        service.recordCycleOutcome("tile", List.of(snapshot("I25", List.of(), "a")), 1);

        assertThat(stored.get().getFailureCode()).isEqualTo("PROVIDER_5XX_RECOVERING");
        assertThat(stored.get().getDetailsJson()).contains("\"failureCategory\":\"PROVIDER_5XX\"");
    }

    @Test
    void legacyNullDataHaltDoesNotBlockPollingAfterUpgrade() {
        AtomicReference<TrafficProviderGuardStatus> stored = stubReadOnlyRepository();
        WebClient healthyClient = WebClient.builder()
            .exchangeFunction(successExchange())
            .build();

        TrafficProviderGuardService service = new TrafficProviderGuardService(
            statusRepository,
            new TrafficObservabilityProps(15, 80, 95, 3, 4, 60),
            healthyClient
        );

        TrafficProviderGuardStatus existing = new TrafficProviderGuardStatus();
        existing.setProviderName("tomtom");
        existing.setState("HALTED");
        existing.setHalted(true);
        existing.setFailureCode("NULL_DATA_THRESHOLD_EXCEEDED");
        existing.setLastCheckedAt(OffsetDateTime.now(ZoneOffset.UTC));
        stored.set(existing);

        assertThat(service.isPollingHalted()).isFalse();
        assertThat(service.isRecovering()).isTrue();
    }

    @Test
    void recoveryProbeMarksReachableProviderAsDegradedUntilUsableTrafficReturns() {
        AtomicReference<TrafficProviderGuardStatus> stored = stubRepository();
        WebClient healthyClient = WebClient.builder()
            .exchangeFunction(successExchange())
            .build();

        TrafficProviderGuardService service = new TrafficProviderGuardService(
            statusRepository,
            new TrafficObservabilityProps(15, 80, 95, 3, 4, 60),
            healthyClient
        );

        TrafficProviderGuardStatus existing = new TrafficProviderGuardStatus();
        existing.setProviderName("tomtom");
        existing.setState("RECOVERING");
        existing.setHalted(false);
        existing.setFailureCode("EMPTY_PAYLOAD_RECOVERING");
        existing.setConsecutiveNullCycles(3);
        existing.setLastCheckedAt(OffsetDateTime.now(ZoneOffset.UTC).minusMinutes(2));
        stored.set(existing);

        service.attemptRecoveryProbe("test-key");

        assertThat(service.isPollingHalted()).isFalse();
        assertThat(stored.get().getState()).isEqualTo("DEGRADED");
        assertThat(stored.get().getFailureCode()).isEqualTo("RECOVERY_PROBE_PASSED");
        assertThat(stored.get().getMessage()).contains("waiting for the next poll cycle");
    }

    @Test
    void recoveryProbeStillHardHaltsAuthorizationFailures() {
        AtomicReference<TrafficProviderGuardStatus> stored = stubRepository();
        WebClient failingClient = WebClient.builder()
            .exchangeFunction(forbiddenExchange())
            .build();

        TrafficProviderGuardService service = new TrafficProviderGuardService(
            statusRepository,
            new TrafficObservabilityProps(15, 80, 95, 3, 4, 60),
            failingClient
        );

        TrafficProviderGuardStatus existing = new TrafficProviderGuardStatus();
        existing.setProviderName("tomtom");
        existing.setState("RECOVERING");
        existing.setHalted(false);
        existing.setFailureCode("EMPTY_PAYLOAD_RECOVERING");
        existing.setLastCheckedAt(OffsetDateTime.now(ZoneOffset.UTC).minusMinutes(2));
        stored.set(existing);

        service.attemptRecoveryProbe("bad-key");

        assertThat(service.isPollingHalted()).isTrue();
        assertThat(stored.get().getState()).isEqualTo("HALTED");
        assertThat(stored.get().isHalted()).isTrue();
        assertThat(stored.get().getFailureCode()).isEqualTo("AUTH_FORBIDDEN");
    }

    @Test
    void usableCycleClearsNullDataCounter() {
        AtomicReference<TrafficProviderGuardStatus> stored = stubRepository();
        WebClient healthyClient = WebClient.builder()
            .exchangeFunction(successExchange())
            .build();

        TrafficProviderGuardService service = new TrafficProviderGuardService(
            statusRepository,
            new TrafficObservabilityProps(15, 80, 95, 3, 4, 60),
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
            new TrafficObservabilityProps(15, 80, 95, 3, 2, 60),
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
            new TrafficObservabilityProps(15, 80, 95, 3, 2, 60),
            healthyClient
        );

        service.recordCycleOutcome("tile", List.of(snapshot("I25", List.of(61.0), "same")), 1);
        service.recordCycleOutcome("tile", List.of(snapshot("I25", List.of(61.0), "same")), 1);
        service.recordCycleOutcome("tile", List.of(snapshot("I25", List.of(62.0), "changed")), 1);

        assertThat(stored.get().getState()).isEqualTo("HEALTHY");
        assertThat(stored.get().getConsecutiveStaleCycles()).isZero();
        assertThat(stored.get().getFailureCode()).isNull();
    }

    @Test
    void markHealthyClearsPreviousShutdownTimestamp() {
        AtomicReference<TrafficProviderGuardStatus> stored = stubRepository();
        WebClient healthyClient = WebClient.builder()
            .exchangeFunction(successExchange())
            .build();

        TrafficProviderGuardService service = new TrafficProviderGuardService(
            statusRepository,
            new TrafficObservabilityProps(15, 80, 95, 3, 2, 60),
            healthyClient
        );

        TrafficProviderGuardStatus existing = new TrafficProviderGuardStatus();
        existing.setProviderName("tomtom");
        existing.setState("HALTED");
        existing.setHalted(true);
        existing.setShutdownTriggeredAt(OffsetDateTime.now(ZoneOffset.UTC).minusMinutes(5));
        stored.set(existing);

        service.markHealthy("Recovered");

        assertThat(stored.get().isHalted()).isFalse();
        assertThat(stored.get().getShutdownTriggeredAt()).isNull();
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

    private AtomicReference<TrafficProviderGuardStatus> stubReadOnlyRepository() {
        AtomicReference<TrafficProviderGuardStatus> stored = new AtomicReference<>();
        when(statusRepository.findById("tomtom")).thenAnswer(invocation -> Optional.ofNullable(stored.get()));
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
