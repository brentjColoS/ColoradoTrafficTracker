package com.example.api_service.dto;

import java.time.OffsetDateTime;

public record TrafficProviderGuardStatusDto(
    String providerName,
    String state,
    boolean halted,
    String failureCode,
    String message,
    String detailsJson,
    int consecutiveNullCycles,
    OffsetDateTime lastCheckedAt,
    OffsetDateTime lastSuccessAt,
    OffsetDateTime lastFailureAt,
    OffsetDateTime shutdownTriggeredAt
) {}
