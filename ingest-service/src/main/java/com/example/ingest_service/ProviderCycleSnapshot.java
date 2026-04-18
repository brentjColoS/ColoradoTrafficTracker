package com.example.ingest_service;

import java.util.List;

public record ProviderCycleSnapshot(
    String corridor,
    List<Double> sampledSpeeds,
    String payloadSignature
) {
    public ProviderCycleSnapshot {
        corridor = corridor == null ? "" : corridor;
        sampledSpeeds = sampledSpeeds == null ? List.of() : List.copyOf(sampledSpeeds);
        payloadSignature = payloadSignature == null ? "" : payloadSignature;
    }
}
