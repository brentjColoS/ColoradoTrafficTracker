package com.example.ingest_service;

import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties(prefix = "routes")
public record RoutesServiceProps(String baseUrl) {}
