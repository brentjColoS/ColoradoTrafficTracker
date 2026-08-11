package com.example.ingest_service;

import java.time.Instant;

public record TomTomResetProbeRun(
    long id,
    Instant ranAt,
    int eligibleAccountCount,
    int attemptedAccountCount
) {}
