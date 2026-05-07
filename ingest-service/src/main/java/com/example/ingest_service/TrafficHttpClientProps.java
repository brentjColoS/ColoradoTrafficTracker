package com.example.ingest_service;

import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties(prefix = "traffic.http-client")
public record TrafficHttpClientProps(
    int connectTimeoutSeconds,
    int responseTimeoutSeconds
) {
    public TrafficHttpClientProps {
        if (connectTimeoutSeconds <= 0) {
            connectTimeoutSeconds = 3;
        }
        if (responseTimeoutSeconds <= 0) {
            responseTimeoutSeconds = 10;
        }
    }
}
