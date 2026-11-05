package com.example.ingest_service;

import java.util.Comparator;
import java.util.List;

final class ProviderCyclePolicy {
    private ProviderCyclePolicy() {}

    record RecoverableProviderFailure(ProviderFailureCategory category, String endpoint, String summary) {}

    enum Kind { HEALTHY, REPEATED, NULL_WARNING, NULL_RECOVERY, CREDITS_EXHAUSTED }

    record Decision(Kind kind, int nullCycles, int staleCycles, String signature,
        String failureCode, String message, String detailsJson, int threshold) {
        boolean successful() {
            return kind == Kind.HEALTHY || kind == Kind.REPEATED;
        }
    }

    static Decision evaluate(String mode, List<ProviderCycleSnapshot> snapshots, int corridorCount,
        TrafficProviderGuardStatus previous, TrafficObservabilityProps props, RecoverableProviderFailure failure) {
        List<ProviderCycleSnapshot> usable = snapshots.stream()
            .filter(ProviderCyclePolicy::hasUsableSpeedData).toList();
        int usableCorridorCount = usable.size();
        if (usableCorridorCount > 0) {
            String signature = cycleSignature(mode, usable);
            int staleCycles = nextStaleCycleCount(previous, signature);
            int threshold = Math.max(2, props.providerStaleCycleThreshold());
            if (staleCycles >= threshold) {
                return new Decision(Kind.REPEATED, 0, staleCycles, signature, "STALE_PAYLOAD_WARNING",
                    "Provider data is still reachable, but the same usable corridor payload has repeated for "
                        + staleCycles + " consecutive cycles. Ingestion remains enabled while this is investigated.",
                    "{\"mode\":\"" + escapeJson(mode)
                        + "\",\"usableCorridors\":" + usableCorridorCount
                        + ",\"corridorCount\":" + corridorCount
                        + ",\"consecutiveStaleCycles\":" + staleCycles
                        + ",\"threshold\":" + threshold + "}", threshold);
            }
            return new Decision(Kind.HEALTHY, 0, staleCycles, signature, null,
                "Provider traffic data is returning usable corridor speeds.",
                "{\"mode\":\"" + escapeJson(mode)
                    + "\",\"usableCorridors\":" + usableCorridorCount
                    + ",\"corridorCount\":" + corridorCount
                    + ",\"consecutiveStaleCycles\":" + staleCycles + "}", threshold);
        }
        int nullCycles = previous.getConsecutiveNullCycles() + 1;
        int threshold = Math.max(1, props.providerNullCycleThreshold());
        if (failure.category() == ProviderFailureCategory.CREDITS_EXHAUSTED) {
            return new Decision(Kind.CREDITS_EXHAUSTED, nullCycles, 0, null, null, null, null, threshold);
        }
        if (nullCycles >= threshold) {
            return new Decision(Kind.NULL_RECOVERY, nullCycles, 0, null, failure.category().recoveringFailureCode(),
                failure.category().recoveryMessage() + " The latest " + nullCycles
                    + " consecutive poll cycles returned no usable speed data across "
                    + corridorCount + " corridors. Ingestion remains enabled and will recover automatically when usable data returns.",
                cycleFailureDetailsJson(mode, failure, corridorCount, nullCycles, threshold), threshold);
        }
        return new Decision(Kind.NULL_WARNING, nullCycles, 0, null, failure.category().code() + "_WARNING",
            failure.category().recoveryMessage() + " Guard will enter recovery after "
                + threshold + " consecutive null-data cycles.",
            cycleFailureDetailsJson(mode, failure, corridorCount, nullCycles, threshold), threshold);
    }

    private static boolean hasUsableSpeedData(ProviderCycleSnapshot snapshot) {
        return snapshot != null && snapshot.sampledSpeeds() != null && !snapshot.sampledSpeeds().isEmpty();
    }

    private static int nextStaleCycleCount(TrafficProviderGuardStatus status, String cycleSignature) {
        if (cycleSignature == null || cycleSignature.isBlank()) {
            return 0;
        }
        String previousSignature = status.getLastCycleSignature();
        if (previousSignature == null || previousSignature.isBlank()) {
            return 0;
        }
        return previousSignature.equals(cycleSignature)
            ? status.getConsecutiveStaleCycles() + 1
            : 0;
    }

    private static String cycleSignature(String mode, List<ProviderCycleSnapshot> usableSnapshots) {
        StringBuilder payload = new StringBuilder(mode == null ? "" : mode);
        usableSnapshots.stream()
            .sorted(Comparator.comparing(ProviderCycleSnapshot::corridor))
            .forEach(snapshot -> payload
                .append('|')
                .append(escapeJson(snapshot.corridor()))
                .append(':')
                .append(escapeJson(snapshot.payloadSignature())));
        return TrafficSampleSignature.sha256(payload.toString());
    }

    private static String cycleFailureDetailsJson(
        String mode,
        RecoverableProviderFailure failure,
        int corridorCount,
        int nullCycleCount,
        int threshold
    ) {
        return "{\"mode\":\"" + escapeJson(mode)
            + "\",\"failureCategory\":\"" + escapeJson(failure.category().code())
            + "\",\"endpoint\":\"" + escapeJson(failure.endpoint())
            + "\",\"summary\":\"" + escapeJson(failure.summary())
            + "\",\"usableCorridors\":0,\"corridorCount\":" + corridorCount
            + ",\"nullCycleCount\":" + nullCycleCount
            + ",\"threshold\":" + threshold + "}";
    }

    static String escapeJson(String value) {
        return value == null ? "" : value
            .replace("\\", "\\\\")
            .replace("\"", "\\\"");
    }

}
