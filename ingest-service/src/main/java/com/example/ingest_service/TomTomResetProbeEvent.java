package com.example.ingest_service;

import java.time.Instant;

public record TomTomResetProbeEvent(
    long id,
    String accountId,
    Instant probedAt,
    TomTomResetProbeOutcome outcome,
    Integer httpStatus,
    String providerCode
) {}
