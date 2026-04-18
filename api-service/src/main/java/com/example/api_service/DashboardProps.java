package com.example.api_service;

import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties(prefix = "dashboard")
public record DashboardProps(
    boolean publicDataEnabled,
    int providerStatusStaleAfterMinutes
) {}
