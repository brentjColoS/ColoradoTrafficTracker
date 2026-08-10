package com.example.ingest_service;

import java.time.Instant;

public record CorridorIncidentSnapshot(
    String corridor,
    String provider,
    String product,
    Instant fetchedAt,
    Instant sourceUpdatedAt,
    String incidentsJson,
    int incidentCount
) {
    public CorridorIncidentSnapshot {
        if (corridor == null || corridor.isBlank()) {
            throw new IllegalArgumentException("corridor must not be blank");
        }
        if (provider == null || provider.isBlank()) {
            throw new IllegalArgumentException("provider must not be blank");
        }
        if (product == null || product.isBlank()) {
            throw new IllegalArgumentException("product must not be blank");
        }
        fetchedAt = fetchedAt == null ? Instant.now() : fetchedAt;
        incidentsJson = incidentsJson == null || incidentsJson.isBlank()
            ? "{\"incidents\":[]}"
            : incidentsJson;
        incidentCount = Math.max(0, incidentCount);
    }
}
