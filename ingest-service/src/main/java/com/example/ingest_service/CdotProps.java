package com.example.ingest_service;

import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties(prefix = "traffic.cdot")
public record CdotProps(
    String apiKey,
    String baseUrl
) {}
