package com.example.api_service.dto;

import java.time.OffsetDateTime;
import java.util.List;

public record IncidentCorridorParityDto(
    String corridor,
    boolean inParity,
    boolean compatibilitySnapshotReadable,
    String compatibilitySnapshotError,
    OffsetDateTime compatibilitySamplePolledAt,
    OffsetDateTime compatibilitySnapshotFetchedAt,
    OffsetDateTime durableLastSeenAt,
    int compatibilityIncidentCount,
    int durableIncidentCount,
    int matchingIdentityCount,
    int unkeyedCompatibilityCount,
    List<String> compatibilityOnlyIdentities,
    List<String> durableOnlyIdentities,
    List<String> payloadMismatchIdentities
) {}
