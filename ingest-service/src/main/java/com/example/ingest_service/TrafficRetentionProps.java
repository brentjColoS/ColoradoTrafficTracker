package com.example.ingest_service;

import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties(prefix = "traffic.retention")
public record TrafficRetentionProps(
    boolean enabled,
    int days,
    String cleanupCron
) {}
