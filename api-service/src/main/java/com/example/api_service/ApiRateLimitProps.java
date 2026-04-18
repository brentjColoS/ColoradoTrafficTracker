package com.example.api_service;

import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties(prefix = "api.rate-limit")
public record ApiRateLimitProps(
    boolean enabled,
    int requestsPerMinute,
    boolean trustForwardedFor
) {}
