package com.example.ingest_service;

import java.time.LocalDate;
import java.util.List;

public record TileQuotaSnapshot(
    long usedThisMonth,
    int target,
    int adaptiveCap,
    int hardStop,
    int allowance,
    LocalDate periodStart,
    LocalDate periodEnd,
    List<TomTomAccountQuotaManager.AccountQuotaSnapshot> accounts
) {}
