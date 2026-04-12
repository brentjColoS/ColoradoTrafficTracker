package com.example.ingest_service;

import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties(prefix = "traffic.timeseries")
public record TrafficTimeseriesProps(
    boolean enabled,
    boolean createHypertables,
    boolean enableCompression,
    boolean createContinuousAggregates,
    int compressionAfterDays
) {}
