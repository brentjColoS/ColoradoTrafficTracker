package com.example.ingest_service;

public record TimeseriesOptimizationStatus(
    boolean enabled,
    boolean postgresCompatible,
    boolean timescaleAvailable,
    boolean optimized,
    boolean hypertablesConfigured,
    boolean compressionConfigured,
    boolean continuousAggregatesConfigured,
    String databaseVersion,
    String message
) {}
