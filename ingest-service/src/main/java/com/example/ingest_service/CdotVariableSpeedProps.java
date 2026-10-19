package com.example.ingest_service;

import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties(prefix = "traffic.cdot-variable-speeds")
public record CdotVariableSpeedProps(boolean enabled, int pollSeconds) {
    public int boundedPollSeconds() { return Math.max(30, pollSeconds); }
}
