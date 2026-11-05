package com.example.ingest_service;

import static com.example.ingest_service.ProviderCyclePolicy.*;
import static org.assertj.core.api.Assertions.*;

import java.util.Arrays;
import java.util.List;
import org.junit.jupiter.api.Test;

class ProviderCyclePolicyTest {
    private final RecoverableProviderFailure failure = new RecoverableProviderFailure(
        ProviderFailureCategory.EMPTY_PAYLOAD, "traffic-poll-cycle", "No usable data");
    private final TrafficObservabilityProps props = new TrafficObservabilityProps(60, 80, 90, 3, 2, 60);

    @Test
    void usableStoppedTrafficResetsNullCyclesAndDoesNotMutatePreviousState() {
        var previous = previous(4, 5, "old");
        var decision = evaluate(List.of(new ProviderCycleSnapshot("I70", List.of(0.0), "stopped")), previous);
        assertThat(decision.kind()).isEqualTo(Kind.HEALTHY);
        assertThat(decision.successful()).isTrue();
        assertThat(decision.nullCycles()).isZero();
        assertThat(decision.staleCycles()).isZero();
        assertThat(decision.failureCode()).isNull();
        assertThat(previous.getConsecutiveNullCycles()).isEqualTo(4);
        assertThat(previous.getConsecutiveStaleCycles()).isEqualTo(5);
        assertThat(previous.getLastCycleSignature()).isEqualTo("old");
    }

    @Test
    void stableCorridorOrderingKeepsRepeatedCyclesSuccessfulAtTheWarningBoundary() {
        var a = new ProviderCycleSnapshot("I25", List.of(40.0), "a");
        var b = new ProviderCycleSnapshot("I70", List.of(60.0), "b");
        var first = evaluate(List.of(a, b), previous(0, 0, null));
        var below = evaluate(List.of(b, a), previous(0, 0, first.signature()));
        assertThat(below.staleCycles()).isEqualTo(1);
        assertThat(below.kind()).isEqualTo(Kind.HEALTHY);
        var at = evaluate(List.of(b, a), previous(0, 1, first.signature()));
        assertThat(at.signature()).isEqualTo(first.signature());
        assertThat(at.kind()).isEqualTo(Kind.REPEATED);
        assertThat(at.successful()).isTrue();
        assertThat(at.staleCycles()).isEqualTo(at.threshold()).isEqualTo(2);
        assertThat(at.failureCode()).isEqualTo("STALE_PAYLOAD_WARNING");
        assertThat(at.detailsJson()).contains("\"usableCorridors\":2", "\"consecutiveStaleCycles\":2");
        assertThat(evaluate(List.of(a, b), previous(0, 2, first.signature())).staleCycles()).isEqualTo(3);
    }

    @Test
    void modeAndPayloadChangesResetRepetitionWhileMissingSnapshotsAreIgnored() {
        var usable = new ProviderCycleSnapshot("I70", List.of(20.0), "a");
        var first = evaluate(List.of(usable), previous(0, 0, null));
        var previous = previous(0, 4, first.signature());
        assertThat(ProviderCyclePolicy.evaluate("point", List.of(usable), 2, previous, props, failure).staleCycles()).isZero();
        assertThat(evaluate(List.of(new ProviderCycleSnapshot("I70", List.of(20.0), "b")), previous).staleCycles()).isZero();
        var mixed = evaluate(Arrays.asList(null, new ProviderCycleSnapshot("I25", null, "missing"), usable), previous);
        assertThat(mixed.signature()).isEqualTo(first.signature());
        assertThat(mixed.detailsJson()).contains("\"usableCorridors\":1");
    }

    @Test
    void nullCyclesEnterRecoverableStateExactlyAtThresholdAndClearRepeatTracking() {
        var snapshots = Arrays.asList((ProviderCycleSnapshot) null,
            new ProviderCycleSnapshot("I70", List.of(), "empty"));
        var below = evaluate(snapshots, previous(1, 9, "old"));
        assertThat(below.kind()).isEqualTo(Kind.NULL_WARNING);
        assertThat(below.nullCycles()).isEqualTo(2);
        assertThat(below.staleCycles()).isZero();
        assertThat(below.signature()).isNull();
        var at = evaluate(snapshots, previous(2, 9, "old"));
        assertThat(at.kind()).isEqualTo(Kind.NULL_RECOVERY);
        assertThat(at.nullCycles()).isEqualTo(3);
        assertThat(at.successful()).isFalse();
        assertThat(at.failureCode()).isEqualTo(ProviderFailureCategory.EMPTY_PAYLOAD.recoveringFailureCode());
        assertThat(at.message()).contains("3 consecutive poll cycles", "Ingestion remains enabled");
    }

    @Test
    void configuredThresholdsKeepTheirMinimumsAndCreditsRemainASeparateDecision() {
        var minimums = new TrafficObservabilityProps(60, 80, 90, 0, 0, 60);
        var empty = List.of(new ProviderCycleSnapshot("I70", List.of(), "empty"));
        assertThat(ProviderCyclePolicy.evaluate("tile", empty, 2, previous(0, 0, null), minimums, failure).kind())
            .isEqualTo(Kind.NULL_RECOVERY);
        var usable = List.of(new ProviderCycleSnapshot("I70", List.of(40.0), "a"));
        var first = evaluate(usable, previous(0, 0, null));
        assertThat(ProviderCyclePolicy.evaluate("tile", usable, 2, previous(0, 0, first.signature()), minimums, failure).kind())
            .isEqualTo(Kind.HEALTHY);
        var credits = new RecoverableProviderFailure(ProviderFailureCategory.CREDITS_EXHAUSTED, "tiles", "exhausted");
        assertThat(ProviderCyclePolicy.evaluate("tile", empty, 2, previous(0, 0, null), props, credits).kind())
            .isEqualTo(Kind.CREDITS_EXHAUSTED);
        assertThat(ProviderCyclePolicy.evaluate("tile", usable, 2, previous(0, 0, null), props, credits).kind())
            .isEqualTo(Kind.HEALTHY);
    }

    private Decision evaluate(List<ProviderCycleSnapshot> snapshots, TrafficProviderGuardStatus previous) {
        return ProviderCyclePolicy.evaluate("tile", snapshots, 2, previous, props, failure);
    }

    private static TrafficProviderGuardStatus previous(int nullCycles, int staleCycles, String signature) {
        var status = new TrafficProviderGuardStatus();
        status.setConsecutiveNullCycles(nullCycles);
        status.setConsecutiveStaleCycles(staleCycles);
        status.setLastCycleSignature(signature);
        return status;
    }
}
