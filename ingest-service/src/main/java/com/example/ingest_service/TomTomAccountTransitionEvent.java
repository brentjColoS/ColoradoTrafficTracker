package com.example.ingest_service;

import java.time.Instant;
import java.time.LocalDate;

public record TomTomAccountTransitionEvent(
    long id,
    Instant observedAt,
    TomTomAccountTransitionType eventType,
    String provider,
    String product,
    LocalDate periodStart,
    LocalDate periodEnd,
    String fromAccountId,
    String toAccountId,
    int callsReserved,
    Long fromAccountRequestsUsed,
    long toAccountRequestsUsed
) {}
