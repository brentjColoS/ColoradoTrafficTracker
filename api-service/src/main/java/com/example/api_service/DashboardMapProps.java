package com.example.api_service;

import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties(prefix = "dashboard.map")
public record DashboardMapProps(String tracestrackApiKey) {
    public boolean tracestrackEnabled() {
        return tracestrackApiKey != null && !tracestrackApiKey.isBlank();
    }
}
